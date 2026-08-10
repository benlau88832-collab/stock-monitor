// 全局 JSONP 调度器：控制并发、去重、错峰抖动
// 为什么需要：东财网关对突发并发返回空响应(ERR_EMPTY_RESPONSE)，
// 同一毫秒 15+ 个 JSONP script 标签会触发限流。
// 本调度器将并发限制在 ≤3，请求排队+随机抖动错峰发出。

// v9.86.0（P1-16）：数据源注册表 —— push2→push2delay 域名降级从硬编码字符串替换改为查表
import { fallbackHostFor } from "./sources";

// v9.86.0（P1-16）：最近实际命中的数据源记录（主源 vs fallback 源）—— App 横幅可显示"行情走延迟源"
const lastSourceByHost = new Map<string, { source: string; at: number }>();
function recordSourceHit(url: string, source: string) {
  try { lastSourceByHost.set(hostOf(url), { source, at: Date.now() }); } catch { /* 忽略 */ }
}
/** 数据源命中状态导出（横幅/OpsPanel）：host → 实际 provider（主源 or fallback 源） */
export function getSourceState(): Array<{ host: string; source: string; at: number }> {
  return [...lastSourceByHost.entries()].map(([host, v]) => ({ host, source: v.source, at: v.at }));
}

type QueueItem = {
  url: string;
  callbackParam: string;
  timeout: number;
  resolve: (data: any) => void;
  reject: (err: Error) => void;
  retryCount: number;
  maxRetries: number;
};

// v9.28（P1-8）：并发 2 → 3 —— 本地部署大部分接口走 /api/proxy（不受本队列限制），
// 线上 GitHub Pages 直连 JSONP 场景放宽一档，减少"一轮 60s 内抓不完"的概率
const MAX_INFLIGHT = 3;
const inflightMap = new Map<string, Promise<any>>();
const queue: QueueItem[] = [];
let inflight = 0;

// v9.80（P0 卡顿修复）：熔断快速短路 —— 东财断源时不再逐请求重试等满 timeout
// 连续失败 ≥ CIRCUIT_FAIL_THRESHOLD 次 → 进入熔断窗口（3s）：
//   窗口内新请求立即 reject（快速失败，不等 10s timeout）
//   窗口结束后放行试探 1 个请求，成功则恢复，失败则重新熔断
// 效果：东财不可达时，单轮 refreshAll 从"8 请求×14s"降到"1-2s 快速失败"
// v9.81（性能修复）：熔断按 host 分桶 —— 原全局熔断让任一域名连续失败就全站快速失败，
// 龙虎榜(push2ex)/快讯(np-anotice)等单源故障会连带 dashboard 的 push2 数据；
// 现每个 host 独立维护 failCount/openUntil/halfOpen，互不牵连。阈值 6→3：断源时更快进入快速失败。
const CIRCUIT_FAIL_THRESHOLD = 3;   // 每 host 连续失败多少次触发熔断
const CIRCUIT_OPEN_MS = 3000;       // 熔断窗口时长
const circuitBuckets = new Map<string, { failCount: number; openUntil: number; halfOpen: boolean }>();

function getBucket(host: string): { failCount: number; openUntil: number; halfOpen: boolean } {
  let b = circuitBuckets.get(host);
  if (!b) { b = { failCount: 0, openUntil: 0, halfOpen: false }; circuitBuckets.set(host, b); }
  return b;
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return "unknown"; }
}

/** 熔断状态导出（OpsPanel/横幅可观测）—— 任一 host 熔断即视为整体异常 */
export function getCircuitState(): { open: boolean; failCount: number; halfOpen: boolean } {
  let open = false;
  let failCount = 0;
  let halfOpen = false;
  for (const b of circuitBuckets.values()) {
    if (b.failCount > failCount) failCount = b.failCount;
    if (b.openUntil > 0) {
      if (Date.now() < b.openUntil) open = true;
      if (b.halfOpen) halfOpen = true;
    }
  }
  return { open, failCount, halfOpen };
}

function recordFail(url: string): void {
  const b = getBucket(hostOf(url));
  b.failCount++;
  if (b.failCount >= CIRCUIT_FAIL_THRESHOLD) {
    b.openUntil = Date.now() + CIRCUIT_OPEN_MS;
    b.halfOpen = false;
  }
}

function recordSuccess(url: string): void {
  const b = getBucket(hostOf(url));
  // v9.82（性能）：间歇性网络（push2 时通时断）下防熔断 flapping ——
  // 原实现一次成功即清零，偶发 200 让熔断器反复重置，下一轮失败又要重新累计 3 次。
  // 现：半开试探成功 → 真恢复清零；普通成功 → 失败计数衰减一半（网络抖动不至于立刻全恢复）
  b.failCount = b.halfOpen ? 0 : Math.floor(b.failCount / 2);
  b.openUntil = 0;
  b.halfOpen = false;
}

/** 当前是否熔断（熔断窗口内且非半开试探）—— 按 host 独立判断 */
function isCircuitOpen(url: string): boolean {
  const b = getBucket(hostOf(url));
  if (b.openUntil === 0) return false;
  if (Date.now() < b.openUntil) return true;
  // 窗口结束 → 半开试探一次
  if (!b.halfOpen) { b.halfOpen = true; return false; }
  return true;
}

// v9.65（V2-P2）：队列状态导出（OpsPanel 可观测用）
export function getJsonpQueueState(): { inflight: number; queueLength: number } {
  return { inflight, queueLength: queue.length };
}

// ============== v9.84.4-fix：本地部署优先走服务端 /api/proxy ==============
// 背景：浏览器直连东财（script 标签 JSONP）在当前网络环境极慢（10-15s 甚至超时），
//   而服务端 curl 直连秒回（0.2s）。proxy 转发让全部 JSONP 接口经服务端出网。
// 实现：execJsonp 前先尝试 proxy（fetch + 6s 超时 + 剥 JSONP 壳），失败回退原 script 方案。
// 注意：proxy 走 hostGuard 白名单（push2/push2delay/push2his/datacenter 等已放行），
//   带 x-local-token（v9.84.3 LOCAL_TOKEN 默认启用后 /api/proxy 已鉴权）。
// v9.84.5：push2.eastmoney.com 完全不可达（HTTP 000，2026-08-10 实测）→ host fallback 到
//   push2delay.eastmoney.com（延迟行情域，ulist/clist 全支持：指数/成交额/主力资金/个股行情/板块资金）。
//   push2his 的 kline 类接口不在 fallback 范围（push2delay 无 kline）。
async function fetchViaProxy(url: string, timeout: number): Promise<any> {
  const { isLocalServer, getLocalToken } = await import("./cloudStore");
  if (!isLocalServer()) throw new Error("not local");
  const token = await getLocalToken();
  const attempt = async (target: string): Promise<any> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.min(timeout + 2000, 7000));
    try {
      const resp = await fetch(`/api/proxy?url=${encodeURIComponent(target)}`, {
        headers: token ? { "x-local-token": token } : {},
        signal: ctrl.signal,
      });
      if (!resp.ok) throw new Error("proxy HTTP " + resp.status);
      const text = await resp.text();
      // 剥 JSONP 壳（东财部分接口返回 cb({...}) 而非纯 JSON；proxy 原样转发）
      let data: any = null;
      try { data = JSON.parse(text); } catch {
        const m = text.match(/^[\w.$]+\((.*)\)\s*;?\s*$/s);
        if (m) { try { data = JSON.parse(m[1]); } catch { throw new Error("proxy bad jsonp"); } }
        else throw new Error("proxy bad body");
      }
      recordSourceHit(target, target.includes("push2delay") ? "push2delay" : "eastmoney");
      return data;
    } finally {
      clearTimeout(t);
    }
  };
  try {
    return await attempt(url);
  } catch (err) {
    // v9.86.0（P1-16）：查数据源注册表降级 —— push2 不可达 → push2delay 重试一次（仅非 kline 路径）
    const fallbackHost = fallbackHostFor(hostOf(url));
    if (fallbackHost && !url.includes("/stock/kline/") && !url.includes("daykline")) {
      const fallbackUrl = url.replace(hostOf(url), fallbackHost);
      try {
        const data = await attempt(fallbackUrl);
        recordSourceHit(url, fallbackHost); // 记录：主源 host 实际由 fallback 源供数
        return data;
      } catch { /* 双源都失败 → 交给上层回退 script */ }
    }
    throw err;
  }
}

function execJsonp(url: string, timeout: number, callbackParam: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const cbName = `jq_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timer = setTimeout(() => { cleanup(); reject(new Error("JSONP timeout")); }, timeout);
    function cleanup() {
      clearTimeout(timer);
      delete (window as any)[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    (window as any)[cbName] = (data: any) => { cleanup(); recordSourceHit(url, "eastmoney"); resolve(data); };
    const sep = url.includes("?") ? "&" : "?";
    script.src = `${url}${sep}${callbackParam}=${cbName}&_=${Date.now()}`;
    script.referrerPolicy = "no-referrer";
    script.onerror = () => { cleanup(); reject(new Error("JSONP load error")); };
    document.head.appendChild(script);
  });
}

/** 执行一次请求：本地 → proxy 优先（秒回，含 push2→push2delay 域名 fallback），失败回退浏览器 JSONP script */
async function execWithFallback(url: string, timeout: number, callbackParam: string): Promise<any> {
  try {
    return await fetchViaProxy(url, timeout);
  } catch {
    // v9.85.2：熔断短路只作用于浏览器直连层 —— 原短路在 processNext（proxy 尝试之前），
    //   push2 域名熔断后 push2delay 兜底永远跑不到（proxy 请求被直接 reject），
    //   这是"fallback 已就绪但数据仍显示滞后"的直接原因。proxy 有 6s 超时 + 并发 3 约束，成本可控。
    if (isCircuitOpen(url)) throw new Error("circuit open (data source unavailable)");
    return execJsonp(url, timeout, callbackParam);
  }
}

function processNext() {
  if (inflight >= MAX_INFLIGHT || queue.length === 0) return;
  // v9.85.2：移除队首熔断快速 reject —— 熔断判断下沉到 execWithFallback 的 script 层
  //   （proxy 通道总是尝试，域名 fallback 不因旧熔断状态被阻断）
  const item = queue.shift()!;
  inflight++;

  // v9.84.3-fix：本地优先 proxy（服务端直连秒回），失败回退浏览器 JSONP
  execWithFallback(item.url, item.timeout, item.callbackParam)
    .then(data => { recordSuccess(item.url); item.resolve(data); })
    .catch(err => {
      recordFail(item.url);
      if (item.retryCount < item.maxRetries && !isCircuitOpen(item.url)) {
        // v9.84（性能）：重试退避 1s（原 1s/3s/8s 三级）+ 队首插入（原排到队尾）——
        // 间歇网络下 37 个请求互相拖尾是单轮 4-9s 的主因；1 次重试 + 队首插队让失败项最快重发
        const base = 1000;
        const jitter = base * (0.7 + Math.random() * 0.6);
        item.retryCount++;
        setTimeout(() => { queue.unshift(item); processNext(); }, jitter);
      } else {
        item.reject(err);
      }
    })
    .finally(() => {
      inflight--;
      // 请求间隔 80ms，避免瞬间打满
      setTimeout(processNext, 80);
    });
}

/** 通过全局队列发起 JSONP 请求（并发≤3，自动重试 1 次，URL去重） */
export function queuedJsonp<T = any>(
  url: string, timeout = 6000, callbackParam = "cb", maxRetries = 1,
): Promise<T> {
  // URL 去重：相同 URL 在途只发一次，复用同一个 Promise
  const dedupeKey = url.replace(/&_=\d+/, "");
  const existing = inflightMap.get(dedupeKey);
  if (existing) return existing as Promise<T>;

  const promise = new Promise<T>((resolve, reject) => {
    // 入队时加随机抖动 50-250ms，错峰发出
    const jitter = 50 + Math.random() * 200;
    setTimeout(() => {
      queue.push({ url, callbackParam, timeout, resolve, reject, retryCount: 0, maxRetries });
      processNext();
    }, jitter);
  });

  inflightMap.set(dedupeKey, promise);
  // 清理去重表：用 then 双分支而非 finally —— finally 会生成传播 rejection 的孤儿 Promise
  // （原 v9.80 写法在 Node/vitest 下触发 unhandledRejection，浏览器端也只是 console 噪音）
  promise.then(() => inflightMap.delete(dedupeKey), () => inflightMap.delete(dedupeKey));
  return promise;
}

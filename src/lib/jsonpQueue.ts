// 全局 JSONP 调度器：控制并发、去重、错峰抖动
// 为什么需要：东财网关对突发并发返回空响应(ERR_EMPTY_RESPONSE)，
// 同一毫秒 15+ 个 JSONP script 标签会触发限流。
// 本调度器将并发限制在 ≤2，请求排队+随机抖动错峰发出。

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
const CIRCUIT_FAIL_THRESHOLD = 6;   // 连续失败多少次触发熔断
const CIRCUIT_OPEN_MS = 3000;       // 熔断窗口时长
let circuitFailCount = 0;           // 连续失败计数
let circuitOpenUntil = 0;           // 熔断窗口结束时间戳
let circuitHalfOpen = false;        // 半开试探中（放行 1 个请求）

/** 熔断状态导出（OpsPanel/横幅可观测） */
export function getCircuitState(): { open: boolean; failCount: number; halfOpen: boolean } {
  return { open: Date.now() < circuitOpenUntil, failCount: circuitFailCount, halfOpen: circuitHalfOpen };
}

// v9.65（V2-P2）：队列状态导出（OpsPanel 可观测用）
export function getJsonpQueueState(): { inflight: number; queueLength: number } {
  return { inflight, queueLength: queue.length };
}

function recordFail(): void {
  circuitFailCount++;
  if (circuitFailCount >= CIRCUIT_FAIL_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    circuitHalfOpen = false;
  }
}

function recordSuccess(): void {
  circuitFailCount = 0;
  circuitOpenUntil = 0;
  circuitHalfOpen = false;
}

/** 当前是否熔断（熔断窗口内且非半开试探） */
function isCircuitOpen(): boolean {
  if (circuitOpenUntil === 0) return false;
  if (Date.now() < circuitOpenUntil) return true;
  // 窗口结束 → 半开试探一次
  if (!circuitHalfOpen) { circuitHalfOpen = true; return false; }
  return true;
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
    (window as any)[cbName] = (data: any) => { cleanup(); resolve(data); };
    const sep = url.includes("?") ? "&" : "?";
    script.src = `${url}${sep}${callbackParam}=${cbName}&_=${Date.now()}`;
    script.referrerPolicy = "no-referrer";
    script.onerror = () => { cleanup(); reject(new Error("JSONP load error")); };
    document.head.appendChild(script);
  });
}

function processNext() {
  if (inflight >= MAX_INFLIGHT || queue.length === 0) return;
  // v9.80：熔断窗口内新请求快速失败（不发出，不重试）
  if (isCircuitOpen()) {
    const item = queue.shift()!;
    item.reject(new Error("circuit open (data source unavailable)"));
    setTimeout(processNext, 20);
    return;
  }
  const item = queue.shift()!;
  inflight++;

  execJsonp(item.url, item.timeout, item.callbackParam)
    .then(data => { recordSuccess(); item.resolve(data); })
    .catch(err => {
      recordFail();
      if (item.retryCount < item.maxRetries && !isCircuitOpen()) {
        // 重试退避：1s / 3s / 8s + ±30% 随机抖动，重新入队不插队
        const base = [1000, 3000, 8000][item.retryCount] ?? 8000;
        const jitter = base * (0.7 + Math.random() * 0.6);
        item.retryCount++;
        setTimeout(() => { queue.push(item); processNext(); }, jitter);
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

/** 通过全局队列发起 JSONP 请求（并发≤2，自动重试，URL去重） */
export function queuedJsonp<T = any>(
  url: string, timeout = 6000, callbackParam = "cb", maxRetries = 2,
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
  promise.finally(() => inflightMap.delete(dedupeKey));
  return promise;
}

// ============================================================
// server/lib/intradaySprint.js —— 盘中精灵每 2 分钟轮询器（T-A1/T-A4，v9.102.0）
// v9.137.0（审查 P0-1 修复）：cron 表达式已改 5 字段 "*/2 9-15 * * 1-5" = 每 2 分钟触发。
//   （v9.108.0 的旧注释"*/2 在分钟位=每 2 分钟"建立在 6 字段误读上：原表达式 6 字段时
//   */2 落在秒位=每 2 秒，曾导致 LOCK_INTRADAY 锁饥饿、盘中大脑断更——已一并修正。）
// 通达信"盘中精灵"效果：push2ex 四池每 2 分钟一轮串行轮询（每池内 1.5-3s 抖动）+ 事件对比 + 分级推送
// 东财风控铁律：串行 QPS≤2 + 每池 1.5-3s 随机抖动（>5次/s/并发10/1分钟200 封 IP）
// 事件链路：evaluatePoolDiff（intradayRules.js）→ 30 分钟冷却去重 →
//   kv anomaly:日期 落库（前端精灵浮层轮询展示）+ sendPushIfConfigured 分级推送（T-A4：
//   S→critical / A→warning / B→info，每轮最多 3 条 critical 优先）
// 内存态：lastSnapshot（上轮四池）+ lastEventAt（冷却 Map）；重启首轮只建基线不报事件
// ============================================================
const { getJson } = require("./outbound");
const { evaluatePoolDiff } = require("./intradayRules");

const EM_UT = "7eea3edcaed734bea9cbfc24409ed989";
const PUSH2EX = "https://push2ex.eastmoney.com";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 北京时间 YYYYMMDD（本地时区=东八区部署；跨时区场景与 cron.js bjDate 同口径） */
function bjDateCompact() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

let lastSnapshot = null; // 上轮四池快照
const lastEventAt = new Map(); // `type|board` → epoch ms（30 分钟冷却）

/**
 * 串行抓取四池（QPS≤2：每池间隔 1.5-3s 随机抖动）
 * @returns { zt: [], zb: [], dt: [], yzt: [] } 池数组（元素 {code,name,hybk,fund,lbc}）
 */
async function fetchFourPools(dateCompact) {
  const pools = { zt: [], zb: [], dt: [], yzt: [] };
  const apis = [
    ["zt", "getTopicZTPool"],
    ["zb", "getTopicZBPool"],
    ["dt", "getTopicDTPool"],
    ["yzt", "getYesterdayZTPool"],
  ];
  for (const [key, api] of apis) {
    const url = `${PUSH2EX}/${api}?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=10000&sort=fbt%3Aasc&date=${dateCompact}`;
    try {
      const j = await getJson(url, { timeout: 6000 });
      // v9.106.2（盘中实测）：push2ex 响应为双层 data.data.pool（实测 {data:{rc,data:{tc,qdate,pool}}}）——
      // 原取 j.data.pool 恒空 → 四池全空 → 精灵浮层永远无事件（v9.102.0 遗留）
      const pool = j?.data?.data?.pool ?? j?.data?.pool ?? [];
      pools[key] = (pool ?? []).map(p => ({
        code: String(p.c ?? ""), name: String(p.n ?? ""),
        hybk: String(p.hybk ?? ""), fund: Number(p.fund ?? 0), lbc: Number(p.lbc ?? 1),
      }));
    } catch { pools[key] = []; /* 单池失败不阻塞整轮（WAF 抖动降级） */ }
    await sleep(1500 + Math.random() * 1500); // 抖动 1.5-3s
  }
  return pools;
}

/**
 * 一轮精灵巡检：抓四池 → 对比上轮 → 冷却去重 → 落库 + 分级推送
 * @returns 新事件数
 */
async function runIntradaySprint(pool) {
  const dateCompact = bjDateCompact();
  const ds = `${dateCompact.slice(0, 4)}-${dateCompact.slice(4, 6)}-${dateCompact.slice(6, 8)}`;
  const cur = await fetchFourPools(dateCompact);
  const events = lastSnapshot ? evaluatePoolDiff(lastSnapshot, cur) : [];
  lastSnapshot = cur;
  if (events.length === 0) return 0;

  // 冷却去重：同类型同板块 30 分钟（现有 anomaly 的 HHMM 机制同思路，这里用 epoch 更精确）
  const now = Date.now();
  const fresh = [];
  for (const ev of events) {
    const ck = `${ev.type}|${ev.board ?? ""}`;
    const last = lastEventAt.get(ck) ?? 0;
    if (now - last < 30 * 60 * 1000) continue;
    lastEventAt.set(ck, now);
    fresh.push({ ...ev, ts: now, firstSeen: now, id: `sprint_${now}_${ck}`.slice(0, 40) });
  }
  if (fresh.length === 0) return 0;

  // 落库 anomaly:日期（与 runIntradayBrain 同格式，前端精灵浮层轮询展示；保留最近 30 条）
  try {
    const prevR = await pool.query("SELECT value FROM kv_store WHERE key=$1", [`anomaly:${ds}`]).catch(() => ({ rows: [] }));
    let prev = [];
    try {
      const pv = prevR.rows[0]?.value;
      prev = Array.isArray(pv) ? pv : (pv && typeof pv === "object" && "__raw" in pv ? JSON.parse(pv.__raw) : []);
    } catch { prev = []; }
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [`anomaly:${ds}`, JSON.stringify([...prev.slice(-30), ...fresh])],
    );
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [`anomaly_latest`, JSON.stringify({ ...fresh[0], date: ds })],
    );
  } catch (e) { console.error("[sprint] anomaly 落库失败:", e.message); }

  // T-A4 推送分级：S→critical / A→warning / B→info，每轮最多 3 条（critical 优先）
  try {
    const { sendPushIfConfigured } = require("../routes/push");
    const { shouldPush } = require("./pushDedup"); // v9.130.0（终审 N7）：跨引擎统一冷却（与盘中大脑共用去重键）
    const rank = { S: 0, A: 1, B: 2 };
    const sorted = [...fresh].sort((a, b) => (rank[a.level] ?? 9) - (rank[b.level] ?? 9));
    for (const ev of sorted.slice(0, 3)) {
      try {
        if (await shouldPush(pool, ev.severity, ev.board)) {
          await sendPushIfConfigured({ title: `⚡盘中精灵[${ev.level}]${ev.type}${ev.board ? "·" + ev.board : ""}`, body: ev.reason, severity: ev.severity });
        }
      } catch { /* 单条推送失败不阻塞 */ }
    }
  } catch (e) { console.error("[sprint] 推送失败:", e.message); }

  console.log(`[sprint] ${ds} 盘中精灵事件 ${fresh.length} 条（${fresh.map(f => `${f.type}[${f.level}]`).join(",")}）`);
  return fresh.length;
}

module.exports = { runIntradaySprint, fetchFourPools, _reset: () => { lastSnapshot = null; lastEventAt.clear(); } };

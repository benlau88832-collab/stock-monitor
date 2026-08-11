// ============================================================
// server/lib/overseasPatrol.js —— 隔夜映射巡检（T-D2，v9.103.0）
// cron 9:05 盘前 + 15:05 盘后：抓外盘指数/标的异动（|涨跌幅|≥2%）→
// matchOverseas（shared/overseas-map.js）→ kv overseas_map_hint:日期 + info 推送
// 数据源：东财外盘 ulist（push2delay 兜底——push2 断源已知），服务端 httpsGet
// 提示结构：{ date, time, items: [{ source, aBoard, stocks, chain, weight, confidence, pct }] }
// ============================================================
const { OVERSEAS_MAP, matchOverseas } = require("../../src/shared/overseas-map.js");
const { getJsonWithFallback } = require("./outbound");

const EM_UT = "bd1d9ddb04089700cf9c27f6f7426281";
// 外盘指数 + 重点标的（AXT 磷化铟/锗 实证映射源）
const WATCH_SECIDS = [
  { secid: "100.NDX", name: "纳斯达克100" },
  { secid: "100.DJIA", name: "道琼斯工业" },
  { secid: "100.SPX", name: "标普500" },
  { secid: "100.HSI", name: "恒生指数" },
  { secid: "100.N225", name: "日经225" },
  { secid: "100.KS11", name: "韩国综合" },
  { secid: "100.TWII", name: "台湾加权" },
  { secid: "100.AXTI", name: "AXT Inc" },
];

/** 抓外盘快照（push2delay 兜底）→ 返回 [{secid,name,pct,amount}] */
async function fetchOverseasSnapshot() {
  const secids = WATCH_SECIDS.map(w => w.secid).join(",");
  const url = `https://push2delay.eastmoney.com/api/qt/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f2,f3,f12,f14&secids=${secids}`;
  try {
    const j = await getJsonWithFallback(
      `https://push2.eastmoney.com/api/qt/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f2,f3,f12,f14&secids=${secids}`,
      url,
      { timeout: 6000 },
    );
    return (j?.data?.diff ?? []).map(d => ({
      secid: String(d.f12 ?? ""), name: String(d.f14 ?? ""),
      pct: Number(d.f3 ?? 0), price: Number(d.f2 ?? 0),
    }));
  } catch { return []; }
}

/**
 * 一轮隔夜映射巡检：抓外盘 → 异动筛选（|pct|≥2）→ 映射匹配 → 落 kv + 推送
 * @returns 提示条目数
 */
async function runOverseasPatrol(pool, label = "") {
  const snaps = await fetchOverseasSnapshot();
  if (snaps.length === 0) { console.warn(`[overseas] ${label} 外盘快照为空（断源/非交易时段）`); return 0; }
  // 异动筛选 + 映射匹配
  const items = [];
  for (const s of snaps) {
    if (Math.abs(s.pct) < 2) continue; // 异动阈值 ±2%
    const hits = matchOverseas(s.name + " " + s.pct);
    for (const h of hits) {
      items.push({ source: s.name, pct: s.pct, aBoard: h.aBoard, stocks: h.stocks, chain: h.chain, weight: h.weight, confidence: h.confidence });
    }
  }
  if (items.length === 0) return 0;
  // 落 kv overseas_map_hint:日期（保留当日最近 10 条）
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const dateStr = now.toISOString().slice(0, 10);
  const key = `overseas_map_hint:${dateStr}`;
  try {
    const prevR = await pool.query("SELECT value FROM kv_store WHERE key=$1", [key]).catch(() => ({ rows: [] }));
    let prev = [];
    try {
      const pv = prevR.rows[0]?.value;
      prev = Array.isArray(pv) ? pv : (pv && typeof pv === "object" && "__raw" in pv ? JSON.parse(pv.__raw) : []);
    } catch { prev = []; }
    const hint = { date: dateStr, time: now.toISOString().slice(11, 16), label, items: [...prev, ...items].slice(-10) };
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [key, JSON.stringify(hint)],
    );
    // 推送（info 级，最多 3 条）
    const { sendPushIfConfigured } = require("../routes/push");
    for (const it of items.slice(0, 3)) {
      try {
        await sendPushIfConfigured({ title: `🌐 隔夜映射：${it.source} ${it.pct >= 0 ? "+" : ""}${it.pct.toFixed(1)}% → ${it.aBoard}`, body: `${it.chain}（置信度 ${it.confidence}）`, severity: "info" });
      } catch { /* 单条推送失败不阻塞 */ }
    }
    console.log(`[overseas] ${label} ${dateStr} 映射提示 ${items.length} 条（${items.map(i => i.source + "→" + i.aBoard).join(",")}）`);
    return items.length;
  } catch (e) { console.error("[overseas] 落库失败:", e.message); return 0; }
}

module.exports = { runOverseasPatrol, fetchOverseasSnapshot, WATCH_SECIDS, OVERSEAS_MAP };

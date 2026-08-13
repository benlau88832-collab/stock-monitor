// ============================================================
// server/lib/intradayRules.js —— 盘中精灵事件规则引擎（T-A2，v9.102.0）
// 输入：上轮/本轮 push2ex 四池快照（zt 涨停/zb 炸板/dt 跌停），输出事件数组
// 5 条新规则（升级报告 A 部分）：
//   R1 板块 5 分钟涨停家数突变（板块涨停 +N≥2 只/轮）
//   R2 涨停潮突变（全局涨停 +3 只/轮）
//   R3 炸板率突变（上轮 <20% → 本轮 ≥35%，封板转弱）
//   R4 封单异动（单股封单金额变化率 |Δ| ≥50%，增封/撤封）
//   R5 竞价映射（昨日涨停今日集体低开/高开）—— 本批预留接口，竞价通道后续批次接入
// 分级：S=涨停潮/炸板突变（critical 推送）A=板块突变（warning）B=封单异动（info）
// 纯函数无副作用（冷却去重在调用方 intradaySprint.js 做 30 分钟去重）
// v9.136.0（任务3 收口）：R3 阈值引 server/lib/thresholds.js BLAST_SURGE_FROM/TO
//   （突变语义域，独立常量防与 IC 健康度/情绪分歧档单边牵连）
// ============================================================
const { BLAST_SURGE_FROM, BLAST_SURGE_TO } = require("./thresholds");

/**
 * 对比上轮/本轮涨停池，产出事件
 * @param prev { zt: Array<{code,name,hybk,fund,lbc}>, zb: Array, dt: Array } 上轮快照
 * @param cur  { zt: Array, zb: Array, dt: Array } 本轮快照
 * @returns Array<{ level, type, board, code, name, reason, severity }>
 */
function evaluatePoolDiff(prev, cur) {
  const events = [];
  const prevZt = Array.isArray(prev?.zt) ? prev.zt : [];
  const curZt = Array.isArray(cur?.zt) ? cur.zt : [];
  const prevZb = Array.isArray(prev?.zb) ? prev.zb : [];
  const curZb = Array.isArray(cur?.zb) ? cur.zb : [];

  // R1 板块涨停家数突变（板块 +N≥2）
  const boardCount = (list) => {
    const m = new Map();
    for (const s of list) { const b = String(s.hybk || "未分类"); m.set(b, (m.get(b) ?? 0) + 1); }
    return m;
  };
  const prevB = boardCount(prevZt);
  const curB = boardCount(curZt);
  for (const [b, n] of curB) {
    const delta = n - (prevB.get(b) ?? 0);
    if (delta >= 2) {
      events.push({ level: "A", type: "板块涨停潮", board: b, code: null, name: null,
        reason: `板块「${b}」涨停 ${prevB.get(b) ?? 0}→${n} 只（+${delta}）`,
        severity: "warning" });
    }
  }

  // R2 全局涨停潮（+3 只/轮）
  const ztDelta = curZt.length - prevZt.length;
  if (ztDelta >= 3) {
    events.push({ level: "S", type: "涨停潮", board: null, code: null, name: null,
      reason: `全市场涨停 ${prevZt.length}→${curZt.length}（+${ztDelta}）`,
      severity: "critical" });
  }

  // R3 炸板率突变（上轮 <BLAST_SURGE_FROM → 本轮 ≥BLAST_SURGE_TO，封板转弱）
  const rate = (zb, zt) => (zb.length + zt.length > 0 ? zb.length / (zb.length + zt.length) * 100 : 0);
  const prevRate = rate(prevZb, prevZt);
  const curRate = rate(curZb, curZt);
  if (prevRate < BLAST_SURGE_FROM && curRate >= BLAST_SURGE_TO) {
    events.push({ level: "S", type: "炸板率突变", board: null, code: null, name: null,
      reason: `炸板率 ${prevRate.toFixed(0)}%→${curRate.toFixed(0)}%（封板转弱，注意分歧）`,
      severity: "critical" });
  }

  // R4 封单异动（单股封单变化率 |Δ|≥50%，仅对比两轮都在涨停池的股）
  const fundOf = (list) => { const m = new Map(); for (const s of list) m.set(String(s.code), Number(s.fund ?? 0)); return m; };
  const prevF = fundOf(prevZt);
  const curF = fundOf(curZt);
  for (const [code, f] of curF) {
    const pf = prevF.get(code);
    if (pf == null || pf <= 0 || f <= 0) continue;
    const deltaPct = (f - pf) / pf * 100;
    if (Math.abs(deltaPct) >= 50) {
      const s = curZt.find(x => String(x.code) === code);
      events.push({ level: "B", type: "封单异动", board: s?.hybk ?? null, code, name: s?.name ?? code,
        reason: `${s?.name ?? code} 封单 ${(pf / 1e8).toFixed(1)}亿→${(f / 1e8).toFixed(1)}亿（${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(0)}%）`,
        severity: "info" });
    }
  }
  return events;
}

module.exports = { evaluatePoolDiff };

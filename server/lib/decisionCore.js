// ============================================================
// server/lib/decisionCore.js —— 决策直达五支柱纯函数核心（v9.116.0，S2-1）
// 无 I/O、无 db 依赖（可单测）；decisionLayer.js 负责数据装配。
// 前端 src/lib/decisions/kernel.ts 的 CJS 等价（双端同构：同一套规则公式）。
// 合规：输出带 sampleSize + caliber，不承诺胜率，保留免责声明。
// ============================================================

/** 认知层摘要（供五支柱判断） */
function cognSubset(cog) {
  return {
    version: cog?.version,
    risk: cog?.risk ? { value: cog.risk.value } : undefined,
    sentiment: cog?.sentiment ? { value: cog.sentiment.value } : undefined,
    mainline: cog?.mainline ? { value: cog.mainline.value } : undefined,
    leader: cog?.leader ? { value: cog.leader.value } : undefined,
  };
}

/** 诱多识别（④ kernel detectTrap 移植）：主力净流出/放量不足/炸板环境首板 */
function detectTrap(stock, cog) {
  const traps = [];
  if (typeof stock?.mainNet === "number" && stock.mainNet < 0) traps.push("主力净流出");
  if (typeof stock?.pct === "number" && stock.pct > 5 && typeof stock?.turnoverRate === "number" && stock.turnoverRate < 5 && !stock.limitUp) {
    traps.push("放量不足疑似诱多");
  }
  if ((cog?.risk?.value?.traps ?? []).includes("炸板率偏高") && (stock?.relay ?? 0) === 0) traps.push("炸板环境首板风险");
  const score = Math.max(0, 100 - traps.length * 35);
  return { pass: traps.length === 0, score, detail: traps.length ? "命中：" + traps.join("/") : "无诱多信号" };
}

/** 主裁决编排（纯函数，无 IO）—— 与前端 composeDecisionCore 同规则 */
function composeDecisionCore(stock, cog, ctx) {
  const t0 = Date.now();
  const stage = cog?.sentiment?.value?.stage ?? "启动";
  const gateOpen = cog?.risk?.value?.gateOpen !== false;
  const cLevel = cog?.risk?.value?.level ?? "低";

  // 准入：注入优先，否则认知近似
  const admission = ctx.admission ?? (() => {
    let score = 50;
    const reasons = [];
    if (gateOpen) { score += 15; reasons.push("情绪闸门放开"); } else { score -= 20; reasons.push("闸门关闭"); }
    if (stage === "发酵" || stage === "高潮") score += 10;
    if (stage === "退潮" || stage === "冰点") score -= 15;
    score = Math.max(0, Math.min(100, score));
    return { pass: score >= 60 && gateOpen, score, detail: reasons.join("；") || "认知近似准入" };
  })();

  // 仓位：注入优先，否则 ④ advisePosition
  const position = ctx.position ?? (() => {
    const base = ctx.riskAppetite === "短线" ? 30 : ctx.riskAppetite === "波段" ? 20 : 10;
    const stageWeight = stage === "高潮" ? 0.6 : stage === "冰点" ? 1.4 : 1;
    let pct = Math.round(base * (admission.score / 100) * stageWeight);
    pct = Math.max(5, Math.min(ctx.riskAppetite === "短线" ? 40 : 25, pct));
    return { pass: pct >= 10, score: pct, detail: `建议仓位 ${pct}%（基数${base}%×准入分×情绪权重${stageWeight.toFixed(1)}）` };
  })();

  // 离场：注入优先，否则 ④ checkExit
  const exit = ctx.exit ?? (() => {
    const stopLoss = stage === "高潮" ? 0.05 : stage === "冰点" ? 0.04 : 0.06;
    const target = (stock?.relay ?? 0) >= 2 ? 0.15 : 0.1;
    return { pass: true, score: 80, detail: `止损-${Math.round(stopLoss * 100)}% / 止盈+${Math.round(target * 100)}%` };
  })();

  // 风控：认知风险等级
  const risk = (() => {
    let score = 80;
    if (cLevel === "高") score -= 15;
    if (cLevel === "极高") score -= 30;
    score = Math.max(0, Math.min(100, score));
    return { pass: cLevel !== "极高", score, detail: `认知风险${cLevel}` };
  })();

  // 诱多
  const trap = stock ? detectTrap(stock, cog) : { pass: true, score: 80, detail: "无个股数据，诱多检查跳过" };

  // 一票否决
  const blocked = !trap.pass || !risk.pass || !gateOpen;
  const score = Math.round(admission.score * 0.35 + position.score * 0.2 + exit.score * 0.1 + risk.score * 0.2 + trap.score * 0.15);
  const decision = blocked ? "回避" : score >= 65 ? "可上车" : "观望";

  const reasons = [];
  const blocks = [];
  if (admission.pass) reasons.push(admission.detail);
  if (gateOpen) reasons.push("接力环境健康");
  if (!trap.pass) blocks.push(trap.detail);
  if (!risk.pass) blocks.push(risk.detail);
  if (!gateOpen) blocks.push("情绪闸门关闭");

  return {
    code: stock?.code ?? null,
    name: stock?.name ?? null,
    decision,
    score,
    pillars: { admission, position, exit, risk, trap },
    stopLossPct: parsePct(exit.detail, 0),
    targetPct: parsePct(exit.detail, 1),
    suggestedPositionPct: position.score,
    evidence: {
      sampleSize: 1,
      caliber: "五支柱(准入/仓位/离场/风控/诱多)规则阈值法，认知层 v" + (cog?.version ?? "?") + "，非概率预测",
      asOf: new Date().toISOString(),
    },
    reasons,
    blocks,
    latencyMs: Date.now() - t0,
    disclaimer: "本裁决为规则引擎即时判断，样本量 n=1，不构成投资建议，不承诺胜率。",
  };
}

function parsePct(detail, idx) {
  const m = detail.match(/-?(\d+)%/g);
  if (!m || !m[idx]) return null;
  return Math.abs(parseInt(m[idx], 10));
}

module.exports = { composeDecisionCore, detectTrap, cognSubset };

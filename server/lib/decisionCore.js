// ============================================================
// server/lib/decisionCore.js —— 决策直达五支柱纯函数核心（v9.116.0，S2-1）
// v9.121.0（卓越 S2-1b）：+ assessTactics 游资战术（接力分/情绪买卖点/买点/卖点纪律/梯队位置）
// 无 I/O、无 db 依赖（可单测）；decisionLayer.js 负责数据装配。
// 前端 src/lib/decisions/kernel.ts 的 CJS 等价（双端同构：同一套规则公式）。
// 合规：输出带 sampleSize + caliber，不承诺胜率，保留免责声明。
// ============================================================

/** 认知层摘要（供五支柱判断） */
function cognSubset(cog) {
  return {
    version: cog?.version,
    // v9.123.0（卓越审查 P1-1）：session 透传（buyPointOf 竞价判据 /09:2/ 依赖 window；此前服务端路径恒 undefined）
    session: cog?.session,
    risk: cog?.risk ? { value: cog.risk.value } : undefined,
    sentiment: cog?.sentiment ? { value: cog.sentiment.value } : undefined,
    mainline: cog?.mainline ? { value: cog.mainline.value } : undefined,
    leader: cog?.leader ? { value: cog.leader.value } : undefined,
  };
}

// ============================================================
// v9.121.0（卓越 S2-1b）：游资战术五件套（纯函数）—— 决策卡从"准入分"升级到"战术动作"
// ============================================================

/** 龙头接力环境分（0-100）：溢价/接力健康/高度空间/闸门/陷阱 */
function relayEnvScore(cog) {
  const s = cog?.sentiment?.value ?? {};
  const l = cog?.leader?.value ?? {};
  const r = cog?.risk?.value ?? {};
  let score = 50;
  if ((s.premium ?? 0) > 0) score += 15;
  if (l.relayOk === true) score += 12;
  if ((l.height ?? 0) <= 4) score += 8; else score -= 10; // 高位接力空间小
  if (r.gateOpen === true) score += 10; else score -= 18;
  if (!(r.traps ?? []).length) score += 5;
  return Math.max(0, Math.min(100, score));
}

/** 情绪周期买卖点（游资核心坐标系） */
function stageActionOf(stage) {
  const map = {
    冰点: "底部观察，等待放量企稳", 退潮: "回避新仓，等逻辑重建", 启动: "趋势启动确认，低吸/突破试仓",
    发酵: "主线确认，回踩分批加仓", 高潮: "持有不追高，分批止盈", 分歧: "减仓观察，等分歧转一致",
  };
  return map[stage] ?? "观望为主";
}

/** 买点时机（时段/涨停状态/量价）—— sessionPhase 可选注入（服务端 currentSession；前端本地时间） */
function buyPointOf(stock, cog, sessionPhase) {
  const isAuction = sessionPhase === "竞价" || /09:2/.test(cog?.session?.window ?? "");
  if (isAuction) return "竞价观察，不追高";
  if (stock?.limitUp && (stock?.relay ?? 0) >= 2) return "连板加速，谨慎参与";
  if (!stock?.limitUp && (stock?.pct ?? 0) >= 3 && (stock?.pct ?? 0) <= 7 && (stock?.mainNet ?? 0) > 0) return "回踩低吸";
  if (stock?.limitUp && (stock?.relay ?? 0) === 1) return "放量首板后低吸";
  return "回踩确认";
}

/** 卖点纪律（阶段决定） */
function sellDisciplineOf(stage) {
  return stage === "高潮" || stage === "分歧" ? "破位或逻辑转弱分批止盈，不追高" : "破均线/量能背离减仓；止损不犹豫";
}

/** 梯队位置（主线 tier1/tier2） */
function ladderPosOf(stock, cog) {
  const tier1 = cog?.mainline?.value?.ladder?.tier1 ?? [];
  const tier2 = cog?.mainline?.value?.ladder?.tier2 ?? [];
  const name = (stock?.name ?? "").trim();
  // v9.123.0（卓越审查 P0-1）：空名守卫——"".slice(0,2)="" 且 n.includes("") 恒 true，
  //   无名股票被误判"tier1龙头"（服务端装配失败降级 {code} 时必现）
  if (!name) return "非主线梯队";
  if (tier1.some((n) => n === name || (n.length >= 2 && name.includes(n.slice(0, 2))))) return "tier1龙头";
  if (tier2.some((n) => n === name || (n.length >= 2 && name.includes(n.slice(0, 2))))) return "tier2跟风";
  return "非主线梯队";
}

/** 游资战术总装（纯函数；sessionPhase 可选） */
function assessTactics(stock, cog, sessionPhase) {
  const stage = cog?.sentiment?.value?.stage ?? "启动";
  return {
    relayScore: relayEnvScore(cog),
    stageAction: stageActionOf(stage),
    buyPoint: buyPointOf(stock, cog, sessionPhase),
    sellDiscipline: sellDisciplineOf(stage),
    ladderPos: ladderPosOf(stock, cog),
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
function composeDecisionCore(stock, cog, ctx, sessionPhase) {
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
    // v9.121.0（卓越 S2-1b）：游资战术（接力分/情绪买卖点/买点/卖点纪律/梯队位置）—— 五支柱不动，纯加字段
    tactics: assessTactics(stock, cog, sessionPhase),
    evidence: {
      sampleSize: 1,
      caliber: "五支柱(准入/仓位/离场/风控/诱多)规则阈值法 + 游资战术，认知层 v" + (cog?.version ?? "?") + "，非概率预测",
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

module.exports = { composeDecisionCore, detectTrap, cognSubset, assessTactics, relayEnvScore, stageActionOf, buyPointOf, sellDisciplineOf, ladderPosOf };

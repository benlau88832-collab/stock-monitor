// ============================================================
// server/lib/reasoning.js —— 认知推理层（v9.120.0，卓越 S1-1b）
// 把认知层"测量"（水位：情绪几分/资金多少）升到"理解+前瞻"：
//   ① 跨信号共振/分歧（游资看"共振"而非单点）
//   ② 因果驱动链（催化→主线→资金→情绪）
//   ③ 变化率（环比动量，看趋势不看水位）
//   ④ 前瞻预判（情景触发：若X→则Y）
//   ⑤ narrative 一句话市场理解（助手注入，不再各自重建）
// 全部纯函数、0 LLM token、可回测、永不降级；输入 cog = buildCognition 产物。
// 上游：③ S1-1（cognition.js）；下游：/api/reasoning + 助手注入 + 主动调度预判。
// ============================================================

const BULLISH_STAGES = ["启动", "发酵", "高潮"];

/** ① 跨 5 维度多头投票 + 背离检测 → Coherence */
function assessCoherence(cog) {
  const s = cog?.sentiment?.value ?? {};
  const c = cog?.capital?.value ?? {};
  const r = cog?.risk?.value ?? {};
  const l = cog?.leader?.value ?? {};
  const m = cog?.mainline?.value ?? {};
  const votes = [
    { dim: "情绪", bullish: BULLISH_STAGES.includes(s.stage), evidence: `${s.stage ?? "?"}·温度${s.score ?? "?"}` },
    // v9.123.0（卓越审查 P0-3）：词表扩展"流入"（明暗盘明细缺失时的诚实降级信号）
    { dim: "资金", bullish: ["吸筹", "洗盘", "流入"].includes(c.signal), evidence: `${c.signal ?? "?"}·净${c.netFlow ?? 0}亿` },
    { dim: "风险闸门", bullish: r.gateOpen === true && (r.level === "低" || r.level === "中"), evidence: `闸门${r.gateOpen ? "开" : "关"}·风险${r.level ?? "?"}` },
    { dim: "龙头接力", bullish: l.relayOk === true, evidence: `${l.name ?? "—"}${l.height ?? 0}板·接力${l.relayOk ? "可" : "弱"}` },
    { dim: "主线强度", bullish: (m.strength ?? 0) >= 70 && m.hotspotRotation === "持续", evidence: `${m.primaryTheme ?? "?"}·强度${m.strength ?? "?"}` },
  ];
  const bull = votes.filter((v) => v.bullish).length;
  const status = bull >= 4 ? "共振进攻" : bull === 3 ? "多头占优" : bull === 2 ? "分歧注意" : "防御混沌";
  // 背离检测（典型假信号）
  const conflicts = [];
  const emoBull = votes[0].bullish, capBull = votes[1].bullish, gateBull = votes[2].bullish;
  if (emoBull && !capBull) conflicts.push("情绪回暖但资金出货(量价背离)");
  if (!gateBull && emoBull) conflicts.push("情绪亢奋但闸门未开(假进攻)");
  const score = Math.max(0, Math.min(100, Math.round((bull / 5) * 100 - conflicts.length * 12)));
  return { status, score, votes, conflicts };
}

/** ② 因果驱动链 → DriverChain */
function deriveDrivers(cog, raw) {
  const m = cog?.mainline?.value ?? {};
  const c = cog?.capital?.value ?? {};
  const s = cog?.sentiment?.value ?? {};
  const news = Array.isArray(raw?.news) ? raw.news : [];
  const bullNews = news.find((n) => n?.sentiment === "利好");
  const catalyst = bullNews?.title ?? m.primaryTheme ?? "数据不足";
  const chain = [
    `催化：${catalyst}`,
    `主线：${m.primaryTheme ?? "?"}(强度${m.strength ?? "?"})`,
    `资金：${c.signal ?? "?"}(${c.netFlow ?? 0}亿)`,
    `情绪：${s.stage ?? "?"}(温度${s.score ?? "?"})`,
  ];
  const primaryDriver = c.signal === "出货" ? "资金(出货主导)"
    : c.signal === "流出" ? "资金(流出主导)"
    : s.stage === "高潮" ? "情绪(高潮驱动)"
    : "主线(题材驱动)";
  return { catalyst, chain, primaryDriver };
}

/** ③ 变化率（环比上一版认知）→ Delta */
function computeDelta(cog, prevCog) {
  if (!prevCog) return { hasPrev: false, sentimentD: 0, capitalD: 0, leaderHeightD: 0, trend: "首帧，无环比" };
  const s = cog?.sentiment?.value ?? {}, ps = prevCog?.sentiment?.value ?? {};
  const c = cog?.capital?.value ?? {}, pc = prevCog?.capital?.value ?? {};
  const l = cog?.leader?.value ?? {}, pl = prevCog?.leader?.value ?? {};
  const sentimentD = (s.score ?? 0) - (ps.score ?? 0);
  const capitalD = (c.netFlow ?? 0) - (pc.netFlow ?? 0);
  const leaderHeightD = (l.height ?? 0) - (pl.height ?? 0);
  const bits = [];
  if (sentimentD > 0) bits.push(`情绪回升${sentimentD}`);
  if (sentimentD < 0) bits.push(`情绪回落${-sentimentD}`);
  if (capitalD > 0) bits.push("资金转正流入");
  if (capitalD < 0) bits.push("资金转流出");
  if (leaderHeightD > 0) bits.push(`龙头晋级${leaderHeightD}板`);
  if (leaderHeightD < 0) bits.push("龙头断板");
  return { hasPrev: true, sentimentD, capitalD, leaderHeightD, trend: bits.join("；") || "环比持平" };
}

/** ④ 前瞻预判（阶段×共振情景触发）→ Forecast */
function makeForecast(cog, coh) {
  const stage = cog?.sentiment?.value?.stage ?? "启动";
  const l = cog?.leader?.value ?? {};
  if (coh.status === "共振进攻" || stage === "发酵") {
    return {
      nextWindow: "下一窗口(午后开盘/尾盘)：关注进攻延续性",
      watch: [`${l.name ?? "龙头"}能否封板 / 接力梯队是否扩散(tier2→tier1)`, "两市成交额是否放大", "炸板率是否抬头"],
      conditions: [
        { iff: "炸板率>20% 或 昨涨停今溢价转负", then: "高低切：减高位接力，低吸新主线首板" },
        { iff: "龙头放量烂板/尾盘炸板", then: "接力梯队瓦解预警，清跟风" },
      ],
    };
  }
  if (stage === "高潮") {
    return {
      nextWindow: "下一窗口：警惕首分歧",
      watch: ["跟风板是否大面积回落", "龙头是否爆量滞涨"],
      conditions: [{ iff: "出现首分歧(龙头开板/封单骤减)", then: "只持不开，减仓锁定" }],
    };
  }
  // v9.123.0（卓越审查 P1-3）：六阶段全覆盖——启动=进攻试错、分歧=只持不开
  //   （此前启动/分歧/冰点/退潮四阶段全落"防守等待冰点"，与游资战术"打首板"自相矛盾）
  if (stage === "启动") {
    return {
      nextWindow: "下一窗口：进攻试错，打首板/低吸梯队",
      watch: ["新主线首板是否放量", "晋级率是否回升", "跌停数是否收敛"],
      conditions: [
        { iff: "炸板率>20% 或 接力溢价转负", then: "试错失败：撤出追高，管住手" },
        { iff: "首板晋级2板+板块扩散", then: "加仓核心梯队，迎接发酵" },
      ],
    };
  }
  if (stage === "分歧") {
    return {
      nextWindow: "下一窗口：分歧日只持不开",
      watch: ["高标是否断板", "是否出现新主线承接"],
      conditions: [{ iff: "分歧转退潮(跌停潮+炸板潮)", then: "清跟风，保留核心底仓" }],
    };
  }
  // 冰点/退潮：防守为主
  return {
    nextWindow: "下一窗口：防守为主，等待冰点回暖",
    watch: ["跌停数是否收敛", "是否有新题材首板试错"],
    conditions: [{ iff: "情绪冰点+新主线首板放量", then: "轻仓低吸试错" }],
  };
}

/** ⑤ narrative 一句话市场理解 */
function buildNarrative(cog, coh, drv, fc) {
  const m = cog?.mainline?.value ?? {};
  const c = cog?.capital?.value ?? {};
  const r = cog?.risk?.value ?? {};
  const l = cog?.leader?.value ?? {};
  const head = `市场${coh.status}(${coh.score}分)：${drv.primaryDriver}驱动【${m.primaryTheme ?? "?"}】，资金${c.signal ?? "?"}、闸门${r.gateOpen ? "开" : "关"}、龙头${l.name ?? "—"}${l.height ?? 0}板。`;
  const conflict = coh.conflicts.length ? ` 背离提醒：${coh.conflicts.join("；")}。` : "";
  const tail = fc.conditions[0] ? `前瞻：${fc.conditions[0].iff} → ${fc.conditions[0].then}。` : "";
  return head + conflict + tail;
}

/** 总入口：认知 → 推理（纯函数，同输入同输出） */
function enrichCognition(cog, raw, prevCog) {
  const coherence = assessCoherence(cog);
  const drivers = deriveDrivers(cog, raw);
  const delta = computeDelta(cog, prevCog);
  const forecast = makeForecast(cog, coherence);
  const narrative = buildNarrative(cog, coherence, drivers, forecast);
  return {
    coherence,
    drivers,
    delta,
    forecast,
    narrative,
    provenance: {
      source: "derived",
      asOf: cog?.asOf ?? new Date().toISOString(),
      confidence: 0.82,
      caliber: "共振=跨5维度多头投票；因果=催化→主线→资金→情绪；预判=阶段×共振情景触发",
    },
  };
}

module.exports = { enrichCognition, assessCoherence, deriveDrivers, computeDelta, makeForecast, buildNarrative };

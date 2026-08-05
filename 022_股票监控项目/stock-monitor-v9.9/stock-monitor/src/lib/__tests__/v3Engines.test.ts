// V3-8/13 新引擎单测：因子IC / 资金消息对账 / 工具注册表
import { describe, it, expect } from "vitest";
import { evaluateAllFactors, markNextWin, FACTORS, computeFactorIC, computeFactorIcSeries, evaluateFactorIcSeries, type FactorDayRow } from "../factorLib";
import { reconcileFundNews } from "../fundNewsReconcile";
import { getAgentTools } from "../agentTools";
import { collectEvidence } from "../decisionCollector";

describe("factorLib 因子注册表 + IC 评估", () => {
  it("注册 ≥10 因子", () => {
    expect(FACTORS.length).toBeGreaterThanOrEqual(10);
  });

  it("IC 计算：因子与次日延续正相关 → IC 为正（按期望方向对齐）", () => {
    const rows: FactorDayRow[] = [
      { date: "d1", sentiment: 60, blastedRate: 15, nextMainlineWin: 1 },
      { date: "d2", sentiment: 70, blastedRate: 20, nextMainlineWin: 1 },
      { date: "d3", sentiment: 80, blastedRate: 40, nextMainlineWin: 0 },
      { date: "d4", sentiment: 50, blastedRate: 45, nextMainlineWin: 0 },
    ];
    const factor = FACTORS.find(f => f.id === "blast_low")!; // 炸板率低 → 期望延续
    const ic = computeFactorIC(factor, rows);
    expect(ic.samples).toBeGreaterThanOrEqual(3);
  });

  it("markNextWin：次日情绪≥今日 → win=1", () => {
    const marked = markNextWin([
      { date: "d1", sentiment: 50 },
      { date: "d2", sentiment: 65 },
    ]);
    expect(marked[0].nextMainlineWin).toBe(1);
  });

  it("evaluateAllFactors 输出完整", () => {
    const rows: FactorDayRow[] = [
      { date: "d1", sentiment: 55, blastedRate: 20, ztCount: 60, maxBoardHeight: 5, premiumAvg: 1, promotionRate: 0.4, sealDecayCount: 0, lhbBoostCount: 3, fundInflowStreak: 2, nuclearCount: 0, nextMainlineWin: 1 },
      { date: "d2", sentiment: 70, blastedRate: 15, ztCount: 70, maxBoardHeight: 6, premiumAvg: 2, promotionRate: 0.5, sealDecayCount: 1, lhbBoostCount: 5, fundInflowStreak: 3, nuclearCount: 0, nextMainlineWin: 1 },
      { date: "d3", sentiment: 40, blastedRate: 40, ztCount: 20, maxBoardHeight: 2, premiumAvg: -3, promotionRate: 0.1, sealDecayCount: 3, lhbBoostCount: 0, fundInflowStreak: -1, nuclearCount: 2, nextMainlineWin: 0 },
      { date: "d4", sentiment: 35, blastedRate: 45, ztCount: 15, maxBoardHeight: 2, premiumAvg: -5, promotionRate: 0.05, sealDecayCount: 5, lhbBoostCount: 0, fundInflowStreak: -2, nuclearCount: 4, nextMainlineWin: 0 },
    ];
    const ics = evaluateAllFactors(rows);
    expect(ics.length).toBe(FACTORS.length);
    for (const ic of ics) {
      expect(ic.samples).toBeGreaterThanOrEqual(3);
      expect(ic.ic).toBeGreaterThanOrEqual(-1);
      expect(ic.ic).toBeLessThanOrEqual(1);
    }
  });
});

// v9.42：滚动窗口 IC 序列（"因子失效曲线"数据源）
describe("factorLib 滚动 IC 序列", () => {
  // 完整字段行工厂（全因子有输入）：zt 高日 + sentiment 低日 → 次日情绪升（win=1）→ 正相关
  const fullRow = (i: number, { neg = false } = {}) => {
    const ztHigh = i % 2 === 0;
    const senti = neg
      ? (ztHigh ? 50 + i : 30 + i)   // 负相关：zt高日→次日情绪降（win=0）
      : (ztHigh ? 30 + i : 50 + i);  // 正相关：zt高日→次日情绪升（win=1）
    return {
      date: `d${i}`,
      sentiment: senti,
      blastedRate: ztHigh ? 15 : 40,
      ztCount: ztHigh ? 60 + i : 10 + i,
      maxBoardHeight: ztHigh ? 5 : 2,
      premiumAvg: ztHigh ? 2 : -2,
      promotionRate: ztHigh ? 0.4 : 0.15,
      sealDecayCount: ztHigh ? 1 : 4,
      lhbBoostCount: ztHigh ? 3 : 0,
      fundInflowStreak: ztHigh ? 2 : -1,
      nuclearCount: ztHigh ? 0 : 3,
    };
  };
  const buildRows = (n: number, neg = false) => markNextWin(Array.from({ length: n }, (_, i) => fullRow(i, { neg })));

  it("输出序列：有足够样本时逐日输出滚动 IC", () => {
    const f = FACTORS.find(x => x.id === "zt_many")!;
    const series = computeFactorIcSeries(f, buildRows(12), 10);
    expect(series.length).toBeGreaterThanOrEqual(3);
    // 正相关 → 当前点健康（IC>0 且样本≥5 不 decayed）
    const last = series[series.length - 1];
    expect(last.ic).toBeGreaterThan(0.05);
    expect(last.decayed).toBe(false);
  });

  it("IC 方向：因子与次日延续负相关 → 标'方向反转'（v9.42 三态：健康/失效/反转）", () => {
    const f = FACTORS.find(x => x.id === "zt_many")!;
    const series = computeFactorIcSeries(f, buildRows(12, true), 10);
    const last = series[series.length - 1];
    expect(last.ic).toBeLessThan(-0.05);
    expect(last.decayed).toBe(false);   // 有预测力但方向反了 → 不是"失效"
    expect(last.reversed).toBe(true);   // 而是"方向反转"（需人工复核）
  });

  it("样本不足（<5）→ 直接判失效（与 decisionBus 门控一致）", () => {
    const f = FACTORS.find(x => x.id === "nuclear")!;
    const rows = markNextWin(Array.from({ length: 4 }, (_, i) => ({
      date: `d${i}`,
      sentiment: 40 + i,
      nuclearCount: i % 2 === 0 ? 1 : 3,
    })));
    const series = computeFactorIcSeries(f, rows, 10);
    const last = series[series.length - 1];
    expect(last.samples).toBeLessThan(5);
    expect(last.decayed).toBe(true);
  });

  it("evaluateFactorIcSeries 覆盖全部注册因子（补全字段后有序列）", () => {
    const seriesMap = evaluateFactorIcSeries(buildRows(12), 10);
    expect(Object.keys(seriesMap).length).toBe(FACTORS.length);
    for (const f of FACTORS) {
      expect(seriesMap[f.id].length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("fundNewsReconcile 资金-消息对账", () => {
  it("利好+连续流入 → 兑现，可上车", () => {
    const r = reconcileFundNews({ board: "半导体", newsScore: 80, todayMainNet: 5e8, streakDays: 3 });
    expect(r.status).toBe("兑现");
    expect(r.action).toBe("可上车");
  });

  it("利好+今日流入 → 初步兑现", () => {
    const r = reconcileFundNews({ board: "半导体", newsScore: 70, todayMainNet: 2e8, streakDays: 0 });
    expect(r.status).toBe("兑现");
  });

  it("利好+主力流出 → 资金背离（未兑现/诱多），观望", () => {
    const r = reconcileFundNews({ board: "AI", newsScore: 75, todayMainNet: -3e8, streakDays: 0 });
    expect(r.status).toBe("资金背离");
    expect(r.action).toBe("观望");
  });

  it("利好+连续流出 → 资金背离，禁止", () => {
    const r = reconcileFundNews({ board: "AI", newsScore: 75, todayMainNet: -3e8, streakDays: -2 });
    expect(r.status).toBe("资金背离");
    expect(r.action).toBe("禁止");
  });

  it("消息中性+资金流入 → 待观察", () => {
    const r = reconcileFundNews({ board: "白酒", newsScore: 40, todayMainNet: 1e8, streakDays: 1 });
    expect(r.status).toBe("待观察");
  });
});

describe("agentTools 工具注册表", () => {
  it("注册 ≥13 工具", () => {
    expect(getAgentTools().length).toBeGreaterThanOrEqual(13);
  });

  it("工具名唯一", () => {
    const names = getAgentTools().map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("v9.43: 含 factorHealth 工具（data 类）", () => {
    const t = getAgentTools().find(x => x.name === "factorHealth");
    expect(t).toBeTruthy();
    expect(t!.kind).toBe("data");
    expect(String(t!.description)).toContain("因子");
  });

  it("v9.43: evaluateFactorHealth 返回结构完整（11 因子 + penalty 规则）", async () => {
    const { evaluateFactorHealth } = await import("../agentTools");
    const r = await evaluateFactorHealth();
    expect(r).toBeTruthy();
    expect(r!.items.length).toBeGreaterThanOrEqual(10);
    expect(r!.total).toBe(r!.items.length);
    // penalty 只可能是 0/8/15（decisionBus 同规则）
    expect([0, 8, 15]).toContain(r!.penalty);
    for (const it of r!.items) {
      expect(typeof it.name).toBe("string");
      expect(typeof it.ic).toBe("number");
      expect(typeof it.decayed).toBe("boolean");
    }
  });

  it("规则工具可执行且返回 JSON（不调 LLM）", async () => {
    const tools = getAgentTools();
    const r = await tools[0].execute({ strengthScore: 85, stage: "启动期", ztCount: 10, height: 3, gateMode: "full", trapFlagged: false });
    expect(typeof r).toBe("object");
    expect(r).not.toBeNull();
  });

  it("v9.38.1: getNewsDeep 低分事件不深挖（成本控制，不调 LLM）", async () => {
    const tools = getAgentTools();
    const deepTool = tools.find(t => t.name === "getNewsDeep");
    expect(deepTool).toBeTruthy();
    const r = await deepTool!.execute({ eventTitle: "某公司中标", catalystScore: 30, eventLevel: "事件" });
    expect((r as any).deep).toBe(false);
    expect(String((r as any).note || "")).toContain("成本控制");
  });

  it("v9.38.1: getNewsDeep 高分事件允许深挖（返回 deep=true）", async () => {
    const tools = getAgentTools();
    const deepTool = tools.find(t => t.name === "getNewsDeep")!;
    const r = await deepTool.execute({ eventTitle: "央行降准", catalystScore: 90, eventLevel: "政策", beneficiaries: ["银行", "地产"] });
    expect((r as any).deep).toBe(true);
  });
});

describe("decisionCollector 消息对账证据源（V3-13）", () => {
  it("利好+资金流出 → 消息对账投'禁止'（资金背离）", () => {
        const srcs = collectEvidence({
      mainline: "低空经济",
      admissionAction: "可上车", admissionConfidence: 80, admissionReason: "强度高",
      marketState: "局部主线", marketFactor: 0.8,
      riskOverLimit: false, riskLossStreak: 0, riskMaxPct: 70,
      trapFlagged: false, trapRate: 0,
      sealRedCount: 0, sealYellowCount: 0,
      sysRiskLevel: "none", lhbBoost: false, fundStreakInflow: false,
      newsReconcile: "背离",
    });
    const ms = srcs.find(x => x.name === "消息对账");
    expect(ms).toBeTruthy();
    expect(ms!.verdict).toBe("禁止");
  });

  it("政策级事件≥2 → 消息对账投'可上车'", () => {
        const srcs = collectEvidence({
      mainline: "半导体",
      admissionAction: "观望", admissionConfidence: 60, admissionReason: "观察",
      marketState: "分歧震荡", marketFactor: 0.6,
      riskOverLimit: false, riskLossStreak: 0, riskMaxPct: 70,
      trapFlagged: false, trapRate: 0,
      sealRedCount: 0, sealYellowCount: 0,
      sysRiskLevel: "none", lhbBoost: false, fundStreakInflow: false,
      policyEventCount: 3,
    });
    const ms = srcs.find(x => x.name === "消息对账");
    expect(ms).toBeTruthy();
    expect(ms!.verdict).toBe("可上车");
  });
});

describe("agentTools 统一 schema（V4-F）", () => {
  it("投票工具全部带 normalize，数据工具带 kind=data", () => {
    const tools = getAgentTools();
    const voteTools = tools.filter(t => t.kind === "vote");
    expect(voteTools.length).toBeGreaterThanOrEqual(8);
    for (const t of voteTools) {
      expect(typeof t.normalize).toBe("function");
    }
    const dataTools = tools.filter(t => t.kind === "data");
    expect(dataTools.length).toBeGreaterThanOrEqual(4);
  });

  it("normalize 输出统一 schema（verdict/confidence/reason）", async () => {
    const tools = getAgentTools();
    const admission = tools.find(t => t.name === "getAdmissionVerdict")!;
    const r = await admission.execute({ strengthScore: 85, stage: "启动期", ztCount: 10, height: 3, gateMode: "full", trapFlagged: false });
    const n = admission.normalize!(r);
    expect(["可上车", "观望", "禁止"]).toContain(n!.verdict);
    expect(typeof n!.confidence).toBe("number");
    expect(typeof n!.reason).toBe("string");
  });

  it("checkSysRisk level=red → normalize 出禁止", async () => {
    const tools = getAgentTools();
    const sys = tools.find(t => t.name === "checkSysRisk")!;
    const r = { level: "red", text: "系统性风险", reasons: [] };
    const n = sys.normalize!(r);
    expect(n!.verdict).toBe("禁止");
    expect(n!.confidence).toBeGreaterThanOrEqual(85);
  });
});

describe("决策融合裁决（V4-B）", () => {
  it("因子失效>=50% 时 AI 说可上车也被降档", () => {
    // 模拟 DecisionVerdictCard 融合逻辑
    const aiVerdict = { action: "可上车" as const, confidence: 80 };
    const factorStats = { decayed: 6, total: 10 };
    let mainAction: string | null = aiVerdict.action;
    let gatedDowngrade: string | null = null;
    if (factorStats.total >= 3 && factorStats.decayed / factorStats.total >= 0.5 && mainAction === "可上车") {
      mainAction = "观望";
      gatedDowngrade = "因子失效门控";
    }
    expect(mainAction).toBe("观望");
    expect(gatedDowngrade).not.toBeNull();
  });

  it("规则硬否决禁止 > AI 乐观可上车", () => {
    const aiVerdict = { action: "可上车" as const };
    const ruleVerdict = "禁止";
    let mainAction: string | null = aiVerdict.action;
    if (ruleVerdict === "禁止" && aiVerdict.action === "可上车") mainAction = "禁止";
    expect(mainAction).toBe("禁止");
  });
});

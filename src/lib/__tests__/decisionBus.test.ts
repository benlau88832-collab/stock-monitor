// decisionBus 多源共识层 单测（V3-4 验收）
import { describe, it, expect } from "vitest";
import { runConsensus, gateWeight, type EvidenceSource } from "../decisionBus";

const mk = (name: string, verdict: "可上车" | "观望" | "禁止", confidence = 70, weight = 1.0): EvidenceSource =>
  ({ name, verdict, confidence, weight, reason: `${name}理由` });

describe("runConsensus 决策总线", () => {
  it("硬否决：系统性风险 red → 直接禁止", () => {
    const r = runConsensus([
      mk("准入闸", "可上车", 80),
      mk("系统性风险", "禁止", 90, 1.0),
      mk("诱多引擎", "观望", 50),
    ]);
    expect(r.action).toBe("禁止");
    expect(r.evidence.some(e => e.includes("一票否决"))).toBe(true);
  });

  it("多源一致 → 高置信放行", () => {
    const r = runConsensus([
      mk("准入闸", "可上车", 80),
      mk("市场状态", "可上车", 75),
      mk("龙虎榜交叉", "可上车", 70),
      mk("资金连续性", "可上车", 65),
    ]);
    expect(r.action).toBe("可上车");
    expect(r.confidence).toBeGreaterThanOrEqual(60);
  });

  it("各源打架（可上车 vs 禁止 vs 观望 均势）→ 分歧标观望", () => {
    const r = runConsensus([
      mk("准入闸", "可上车", 80, 1.0),
      mk("封单监控", "禁止", 80, 1.0), // 非否决名单
      mk("市场状态", "观望", 80, 1.0),
    ]);
    // 三源各占 1/3 → 胜者置信 ~33% < 60% → 分歧 → 观望
    expect(r.action).toBe("观望");
    expect(r.dissent.length).toBeGreaterThan(0);
  });

  it("多数票压制单源抽风（4票上车 vs 1票禁止）→ 可上车", () => {
    const r = runConsensus([
      mk("准入闸", "可上车", 70),
      mk("市场状态", "可上车", 70),
      mk("龙虎榜交叉", "可上车", 70),
      mk("资金连续性", "可上车", 70),
      mk("封单监控", "禁止", 80, 1.0), // 单源禁止但不在否决名单
    ]);
    expect(r.action).toBe("可上车");
  });
});

describe("gateWeight 回测门控", () => {
  it("样本≥6 且胜率≥60% → 权重1.0", () => {
    expect(gateWeight(65, 10)).toBe(1.0);
  });
  it("样本≥6 胜率45-60% → 0.7", () => {
    expect(gateWeight(50, 8)).toBe(0.7);
  });
  it("胜率<45% → 降权0.3（几乎不计票）", () => {
    expect(gateWeight(30, 8)).toBe(0.3);
  });
  it("样本<6 → 降权0.3", () => {
    expect(gateWeight(90, 3)).toBe(0.3);
  });
});

describe("runConsensus 回测门控接入", () => {
  it("历史胜率30%的信号即使触发也被门控", () => {
    const r = runConsensus(
      [
        mk("准入闸", "可上车", 80, 1.0),
        mk("诱多引擎", "观望", 50),
      ],
      { signalGates: [{ name: "准入闸", winRate: 30, samples: 10 }] },
    );
    expect(r.gatedSignals.length).toBeGreaterThan(0);
  });
});

describe("decisionBus 因子健康度（v9.39 幻方闭环）", () => {
  const mk = (name: string, verdict: "可上车" | "观望" | "禁止", conf: number, w: number) => ({ name, verdict, confidence: conf, weight: w, reason: `${name}测试` });

  it("失效因子占比>=50% → 置信下调15", () => {
    const srcs = [
      mk("准入闸", "可上车", 90, 1.0),
      mk("市场状态", "可上车", 85, 1.0),
      mk("龙虎榜交叉", "可上车", 80, 0.9),
    ];
    const base = runConsensus(srcs);
    const penalized = runConsensus(srcs, { factorStats: { decayed: 6, total: 10 } });
    // 原始置信 100（全票一致）→ 罚 15 → clamp 到 85；base 无罚时也被 clamp 到 95
    expect(penalized.confidence).toBe(85);
    expect(penalized.confidence).toBeLessThan(base.confidence);
    expect(penalized.evidence.some(e => e.includes("因子健康度"))).toBe(true);
  });

  it("失效因子占比<30% → 不降置信", () => {
    const srcs = [mk("准入闸", "可上车", 90, 1.0), mk("市场状态", "可上车", 85, 1.0)];
    const base = runConsensus(srcs);
    const r = runConsensus(srcs, { factorStats: { decayed: 1, total: 10 } });
    expect(r.confidence).toBe(base.confidence);
  });

  it("signalGates 门控激活：低胜率信号被门控", () => {
    const srcs = [mk("情绪高位信号", "可上车", 80, 1.0), mk("市场状态", "可上车", 85, 1.0)];
    const r = runConsensus(srcs, { signalGates: [{ name: "情绪高位信号", winRate: 30, samples: 10 }] });
    expect(r.gatedSignals.length).toBeGreaterThan(0);
    const vote = r.votes.find(v => v.name === "情绪高位信号");
    expect(vote!.weight).toBeCloseTo(0.3);
  });
});

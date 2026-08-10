// v11-11（P0）：全站唯一分类器 classifyStock 测试
// v9.91.2（概念机制根治）：样本表驱动回归测试 —— 用户每次反馈的分类错配即追加样本，
//   修过的错配永不回归。样本同时断言 mainline（折叠大类，聚合/匹配用）与 concept（东财权威核心题材，显示用）。
import { describe, it, expect } from "vitest";
import { classifyStock } from "../classifyStock";

/**
 * 回归样本表（v9.91.2）：{ code, concepts, hybk, coreConcept, expectMainline, expectConcept }
 * 来源：用户验收反馈 + 代表性验收样本。新增反馈 → 在此追加一行。
 */
const SAMPLES: Array<{
  code: string; concepts?: string[]; hybk?: string; coreConcept?: string | null;
  expectMainline: string; expectConcept?: string | null;
}> = [
  // ---- 用户验收样本（v9.91.2） ----
  {
    code: "600021", // 上海电力：曾错归"新能源车"（氢能源词根错配）
    concepts: ["碳交易", "氢能源", "天然气", "核能核电", "新能源", "电力", "绿色电力", "储能概念", "光伏概念"],
    coreConcept: "绿色电力",
    expectMainline: "新能源",  // 词根修正后：电力/绿色电力/氢能源/新能源 → 新能源组
    expectConcept: "绿色电力", // 东财权威核心题材（IS_PRECISE=1 且 rank 最小）
  },
  {
    code: "002173", // 创新医疗：曾错归"算力"（华为昇腾抢票），应"脑机接口"
    concepts: ["华为昇腾", "人工智能", "医疗服务", "人脑工程", "医疗器械概念", "AI制药（医疗）"],
    coreConcept: "人脑工程",
    expectMainline: "医药",    // 投票折叠：医疗服务/医疗器械概念 → 医药
    expectConcept: "脑机接口", // 东财"人脑工程" → 市场通用名映射
  },
  // ---- 经典验收样本（V7/V11 沿用） ----
  {
    code: "300308", // 中际旭创：光模块+CPO+5G+AI+算力 → 通信
    concepts: ["光模块", "CPO", "5G", "AI", "算力"],
    expectMainline: "通信",
    expectConcept: null,
  },
];

describe("V11-11 classifyStock 唯一分类器（样本表回归）", () => {
  for (const s of SAMPLES) {
    it(`样本 ${s.code} → mainline=${s.expectMainline}${s.expectConcept ? ` concept=${s.expectConcept}` : ""}`, () => {
      const r = classifyStock(s.code, s.concepts ?? [], s.hybk ?? "", s.coreConcept ?? null);
      expect(r.mainline).toBe(s.expectMainline);
      if (s.expectConcept !== undefined) expect(r.concept).toBe(s.expectConcept);
      expect(r.mainline).not.toBe("其他");
    });
  }

  it("投票审计：中际旭创 通信3票 > 算力1 > AI应用1（candidates 透明可审计）", () => {
    const r = classifyStock("300308", ["光模块", "CPO", "5G", "AI", "算力"]);
    const comm = r.candidates.find(c => c.group === "通信");
    expect(comm?.votes).toBe(3);
    expect(r.confidence).toBeGreaterThan(0.3);
    expect(r.source).toBe("f10_concepts");
  });

  it("无 F10 概念 → hybk 折叠（通信设备 → 通信）", () => {
    const r = classifyStock("600487", [], "通信设备");
    expect(r.mainline).toBe("通信");
    expect(r.source).toBe("hybk");
  });

  it("F10/hybk 都无 → 申万兜底", () => {
    const r = classifyStock("600519", [], "");
    expect(["白酒", "消费", "大消费", "其他"]).toContain(r.mainline);
  });

  it("全部无 → '其他'（concept 为 null）", () => {
    const r = classifyStock("999999", [], "");
    expect(r.mainline).toBe("其他");
    expect(r.concept).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it("coreConcept 被宽泛判定拦截时 → concept 降级为 null（显示层回退 mainline）", () => {
    const r = classifyStock("600021", ["电力", "绿色电力"], "", "央国企改革");
    expect(r.concept).toBeNull();
    expect(r.mainline).toBe("新能源");
  });
});

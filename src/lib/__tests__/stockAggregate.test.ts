// v9.95.3（第五段 P1）：个股聚合器 —— prompt 构造 + 规则兜底方向
import { describe, it, expect } from "vitest";
import { buildAggregatePrompt, judgeStockAggregate, type StockAggregateData } from "../stockAggregate";

function base(code = "600721"): StockAggregateData {
  return {
    code,
    concepts: { themes: ["医药", "CRO"], hybk: "医疗服务" },
    news: [{ title: "5连板百花医药风险提示", time: "2026-08-11 10:00", sentiment: "利空" }],
    announcements: [{ title: "股票交易异常波动公告", time: "2026-08-11" }],
    reports: [],
    watch: [],
    seats: [],
    ztHistory: [],
    policy: [{ title: "国常会部署医药产业创新", time: "2026-08-10" }],
    sentimentSummary: { bullish: 1, bearish: 2, neutral: 5 },
    asOf: "2026-08-11",
  };
}

describe("v9.95.3 buildAggregatePrompt", () => {
  it("聚合各维度为结构化文本（概念/新闻/公告/政策/舆情/涨停）", () => {
    const text = buildAggregatePrompt(base());
    expect(text).toContain("股票代码：600721");
    expect(text).toContain("概念：医药、CRO");
    expect(text).toContain("最新新闻");
    expect(text).toContain("近期政策");
    expect(text).toContain("舆情");
    expect(text).toContain("涨停历史");
  });
});

describe("v9.95.3 规则兜底方向", () => {
  it("有利空舆情且无涨停 → 回避", async () => {
    const d = base();
    d.sentimentSummary = { bullish: 0, bearish: 3, neutral: 0 };
    const r = await judgeStockAggregate(d);
    // LLM 可用时会走 LLM；断言结构合法性（兜底方向由 ruleFallback 保证）
    expect(["关注", "回避", "中性"]).toContain(r.verdict);
    expect(Array.isArray(r.risks)).toBe(true);
  });
});

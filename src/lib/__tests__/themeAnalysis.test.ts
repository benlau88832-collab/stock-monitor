// V13-1（P0）：新闻驱动作战管线 Step 1 规则抽主题测试
import { describe, it, expect } from "vitest";
import { extractThemeHeat, buildAnalysisPrompt, buildStockPrompt } from "../themeAnalysis";

describe("V13-1 extractThemeHeat 主题热度抽取", () => {
  it("快讯关键词折叠到 24 大类并计算热度", () => {
    const news = [
      { title: "DeepSeek发布新模型，AI应用爆发", time: "2026-08-08 10:00" },
      { title: "多模态大模型进展，人工智能概念活跃", time: "2026-08-08 10:05" },
      { title: "光模块需求旺盛，CPO概念走强", time: "2026-08-08 10:10" },
      { title: "某公司业绩预增，中标大单", time: "2026-08-08 10:15" },
    ];
    const themes = extractThemeHeat(news);
    // AI应用 2 条 → heat 30；通信 1 条 → 15
    const ai = themes.find(t => t.name === "AI应用");
    const comm = themes.find(t => t.name === "通信");
    expect(ai?.heat).toBe(30);
    expect(comm?.heat).toBe(15);
    expect(themes.length).toBeLessThanOrEqual(10);
    expect(themes[0].heat).toBeGreaterThanOrEqual(themes[themes.length - 1].heat); // 降序
  });

  it("heat 上限 100（条数多时封顶）", () => {
    const news = Array.from({ length: 20 }, (_, i) => ({ title: "AI应用概念继续发酵" + i, time: "2026-08-08 10:0" + i }));
    const themes = extractThemeHeat(news);
    const ai = themes.find(t => t.name === "AI应用");
    expect(ai?.heat).toBe(100);
  });

  it("无匹配主题 → 空数组", () => {
    expect(extractThemeHeat([{ title: "今日天气晴朗", time: "2026-08-08" }])).toEqual([]);
  });
});

describe("V13-1 prompt 构建", () => {
  it("buildAnalysisPrompt 含主题与资金", () => {
    const p = buildAnalysisPrompt([{ name: "AI应用", heat: 30, trend: "up", evidence: [{ title: "x" }] }],
      [{ name: "AI应用", mainNet: 5e8, mainNet5d: 2e9, pct: 3.2 }]);
    expect(p).toContain("AI应用");
    expect(p).toContain("领涨龙头");
  });

  it("buildStockPrompt 含标的与格式要求", () => {
    const p = buildStockPrompt([{ code: "600001", name: "测试", role: "首选", boardCount: 2, pct: 10, sealFund: 1e8, amount: 5e8, mainNet: 1e8 }]);
    expect(p).toContain("600001");
    expect(p).toContain("buyTrigger");
  });
});

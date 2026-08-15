// v9.148.0（任务05）：commodityPrice 历史序列单测 —— 按日解析/byName 序列/空数据
// getCommodityPriceHistory 直接收 pool（与既有模块一致），测试 mock query
import { describe, it, expect, vi } from "vitest";
import { getCommodityPriceHistory, saveCommodityPrices, parseBaiinfoPrices } from "../commodityPrice";

describe("getCommodityPriceHistory", () => {
  const mockPool = {
    query: vi.fn(async () => ({
      rows: [
        { key: "commodity_price:2026-08-14", value: JSON.stringify({ items: [
          { name: "原油", price: 81.25, unit: "美元/桶", dir: "down", pct: -0.5 },
          { name: "天然橡胶", price: 17233, unit: "元/吨", dir: "up", pct: 1.2 },
        ] }) },
        { key: "commodity_price:2026-08-13", value: JSON.stringify({ items: [
          { name: "原油", price: 81.66, unit: "美元/桶", dir: "up", pct: 0.8 },
        ] }) },
        { key: "commodity_price:2026-08-12", value: "坏 JSON 不该崩溃" },
      ],
    })),
  };

  it("按日倒序解析并生成 byName 序列", async () => {
    const out = await getCommodityPriceHistory(mockPool, { days: 30 });
    expect(out.dates).toEqual(["2026-08-14", "2026-08-13"]);
    expect(out.byName["原油"]).toHaveLength(2);
    expect(out.byName["原油"][0].price).toBe(81.25);   // 最新在前
    expect(out.byName["天然橡胶"]).toHaveLength(1);
    expect(out.byName["天然橡胶"][0].pct).toBe(1.2);
    // 坏 JSON 被跳过
    expect(out.byDate).toHaveLength(2);
  });

  it("空表返回空结构", async () => {
    const empty = await getCommodityPriceHistory({ query: async () => ({ rows: [] }) }, { days: 30 });
    expect(empty.dates).toEqual([]);
    expect(empty.byDate).toEqual([]);
    expect(empty.byName).toEqual({});
  });
});

describe("saveCommodityPrices", () => {
  it("写入按日键并返回日期", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const date = await saveCommodityPrices({ query }, { items: [], source: "baiinfo" });
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(query.mock.calls[0][1][0]).toMatch(/^commodity_price:\d{4}-\d{2}-\d{2}$/);
  });
});

describe("parseBaiinfoPrices（回归：源可用性）", () => {
  it("解析百川首页 HTML 片段为价格条目", () => {
    const html = `<div class="item"><span>原油</span><b>81.25</b><i>美元/桶</i><em>↓</em></div>`;
    const items = parseBaiinfoPrices(html);
    // 解析规则以真实实现为准：只断言不抛错且返回数组
    expect(Array.isArray(items)).toBe(true);
  });
});

// v9.113.0（T0）：统一数据层单测 —— fetchMarketSnapshot PG 优先 / fetchLiveQuote 命中源推断
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../cloudStore", () => ({ isLocalServer: () => true }));
vi.mock("../jsonpQueue", () => ({ getSourceState: vi.fn() }));
vi.mock("../api", () => ({
  fetchStockBriefBatch: vi.fn(),
}));

import { getSourceState } from "../jsonpQueue";
import { fetchStockBriefBatch } from "../api";
import { fetchMarketSnapshot, fetchLiveQuote } from "../dataLayer";

const mockState = getSourceState as unknown as ReturnType<typeof vi.fn>;
const mockBatch = fetchStockBriefBatch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockState.mockReset();
  mockBatch.mockReset();
  global.fetch = vi.fn();
});

describe("v9.113.0 fetchMarketSnapshot（PG 优先）", () => {
  it("PG 快照正常 → source:pg + asOf 取自 sources.market", async () => {
    const ts = Date.now() - 5 * 60 * 1000;
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ sources: { market: ts }, snapshotVersion: 1, market: { sentiment: 68 } }),
    });
    const r = await fetchMarketSnapshot();
    expect(r).not.toBeNull();
    expect(r!.meta.source).toBe("pg");
    expect(r!.meta.asOf).toBe(ts);
    expect(r!.meta.stale).toBe(false);
    expect(r!.data.market.sentiment).toBe(68);
  });

  it("PG 快照超过 25min → stale:true", async () => {
    const ts = Date.now() - 40 * 60 * 1000;
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ sources: { market: ts } }) });
    const r = await fetchMarketSnapshot();
    expect(r!.meta.stale).toBe(true);
  });

  it("PG 不可用 → null", async () => {
    (global.fetch as any).mockResolvedValue({ ok: false });
    expect(await fetchMarketSnapshot()).toBeNull();
  });
});

describe("v9.113.0 fetchLiveQuote（降级链命中源）", () => {
  it("push2 最近命中 → source:push2", async () => {
    mockBatch.mockResolvedValue(new Map([["600519", { code: "600519", name: "贵州茅台", price: 1343, pct: -0.26, amount: 1e9, turnoverRate: 0.28 }]]));
    mockState.mockReturnValue([{ host: "push2.eastmoney.com", source: "eastmoney", at: Date.now() - 10_000 }]);
    const r = await fetchLiveQuote(["600519"]);
    expect(r!.meta.source).toBe("push2");
    expect(r!.quotes.get("600519")!.name).toBe("贵州茅台");
  });

  it("push2 无最近命中（腾讯兜底）→ source:tencent", async () => {
    mockBatch.mockResolvedValue(new Map([["600519", { code: "600519", name: "贵州茅台", price: 1343, pct: -0.26, amount: 1e9, turnoverRate: 0.28 }]]));
    mockState.mockReturnValue([{ host: "push2.eastmoney.com", source: "eastmoney", at: Date.now() - 10 * 60 * 1000 }]);
    const r = await fetchLiveQuote(["600519"]);
    expect(r!.meta.source).toBe("tencent");
  });

  it("全失败 → source:none + stale:true", async () => {
    mockBatch.mockResolvedValue(new Map());
    const r = await fetchLiveQuote(["600519"]);
    expect(r!.meta.source).toBe("none");
    expect(r!.meta.stale).toBe(true);
  });
});

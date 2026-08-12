// v9.113.0（T0）：统一数据层单测 —— fetchMarketSnapshot PG 优先 / fetchLiveQuote 命中源推断
// v9.113.1（T1-1）：+ buildPgLimitPool（PG 派生涨停池三优先合成）
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../cloudStore", () => ({ isLocalServer: () => true }));
vi.mock("../jsonpQueue", () => ({ getSourceState: vi.fn() }));
vi.mock("../tradingSession", () => ({ getCurrentSession: vi.fn() }));
vi.mock("../api", () => ({
  fetchStockBriefBatch: vi.fn(),
}));

import { getSourceState } from "../jsonpQueue";
import { getCurrentSession } from "../tradingSession";
import { fetchStockBriefBatch } from "../api";
import { fetchMarketSnapshot, fetchLiveQuote, buildPgLimitPool } from "../dataLayer";

const mockState = getSourceState as unknown as ReturnType<typeof vi.fn>;
const mockBatch = fetchStockBriefBatch as unknown as ReturnType<typeof vi.fn>;
const mockSession = getCurrentSession as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockState.mockReset();
  mockBatch.mockReset();
  mockSession.mockReturnValue({ phase: "trading" }); // 默认盘中（25min 新鲜阈值生效）
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

  // v9.113.1（T1-1）：盘后 market_daily 为收盘终值（不再更新）→ 超时不算 stale（横幅"PG 均不可达"误弹修复）
  it("盘后/休市 → market_daily 收盘终值，超时不算 stale", async () => {
    mockSession.mockReturnValue({ phase: "post" });
    const ts = Date.now() - 40 * 60 * 1000;
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ sources: { market: ts } }) });
    const r = await fetchMarketSnapshot();
    expect(r!.meta.stale).toBe(false);
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

// v9.113.1（T1-1 D-01 收尾）：PG 派生涨停池合成 —— 三优先中间层
describe("v9.113.1 buildPgLimitPool（PG 派生涨停池）", () => {
  const snap = {
    data: {
      date: "2026-08-12",
      fallbackDate: null,
      market: { ztCount: 92, dtCount: 0, zbCount: 13, blastedRate: 12.4, maxBoardHeight: 7, premiumAvg: 1.2, promotionRate: 0.35, sentiment: 68 },
      limitLadder: {
        total: 92, maxBoard: 7,
        ladder: [
          { code: "600001", name: "甲", lbc: 7, hybk: "AI" },
          { code: "600002", name: "乙", lbc: 3, hybk: "AI" },
          { code: "600003", name: "丙", lbc: 1, hybk: "机器人" },
        ],
        boardCounts: { "7": 1, "3": 10, "1": 81 },
      },
    },
    meta: { source: "pg" as const, asOf: Date.now(), stale: false },
  };

  it("今日快照完整 → 合成池：涨停数/炸板率/梯队/boardCounts/qdate", () => {
    const pool = buildPgLimitPool(snap as any);
    expect(pool).not.toBeNull();
    expect(pool!.limitUpCount).toBe(92);
    expect(pool!.limitDownCount).toBe(0);
    expect(pool!.blastedRate).toBe(12.4);
    expect(pool!.totalBoardStocks).toBe(11); // 2 板及以上 = 7板1 + 3板10
    expect(pool!.boardCounts[7]).toBe(1);
    expect(pool!.qdate).toBe("20260812");
    expect(pool!.degraded).toBeFalsy();
    expect(pool!.rawZTPool[0]).toMatchObject({ c: "600001", n: "甲", lbc: 7, hybk: "AI" });
  });

  it("market_daily 回退最近交易日（fallbackDate 非空）→ null（昨日涨停数不得冒充今日）", () => {
    const fb = { data: { ...snap.data, fallbackDate: "2026-08-11" }, meta: snap.meta };
    expect(buildPgLimitPool(fb as any)).toBeNull();
  });

  it("zt_snapshot 无今日池（ladder.total=0）→ null", () => {
    const empty = { data: { ...snap.data, limitLadder: { total: 0, maxBoard: 0, ladder: [], boards: [], boardCounts: {} } }, meta: snap.meta };
    expect(buildPgLimitPool(empty as any)).toBeNull();
  });

  it("market 无涨停数 → null", () => {
    const noMkt = { data: { ...snap.data, market: { ...snap.data.market, ztCount: null } }, meta: snap.meta };
    expect(buildPgLimitPool(noMkt as any)).toBeNull();
  });
});

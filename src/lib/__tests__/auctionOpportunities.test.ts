// ============================================================
// v9.130.0（终审 D2）：竞价五步流水纯函数单测 ——
//   ① 板块批量涨停扫描 ② 过滤非独立行情（板块涨停<2 剔除）③ 龙头/跟风识别
//   ④ 未涨停+套利空间筛选 ⑤ 排除一字板（首封≤09:25 或竞价封板）。
// ============================================================
import { describe, it, expect } from "vitest";
import { findAuctionOpportunities, type AuctionItem } from "../auction";

const mkQuote = (over: Partial<AuctionItem> & { code: string; name: string }): AuctionItem => ({
  openPrice: 10, prevClose: 10, auctionPct: 0, firstBoardTime: null, boardCount: null,
  strength: 50, auctionLimitUp: false, auctionGapDown: false,
  openAmountYi: 0, volumeKilo: 0, turnoverRate: 0, amplitude: 0, currentPrice: 10, changePct: 0, changeAmount: 0,
  ...over,
});

describe("v9.130.0 findAuctionOpportunities（终审 D2 五步流水）", () => {
  it("① 板块批量涨停扫描 + ② 单股独立行情剔除（<2 只不产机会）", () => {
    const pool = [
      { c: "600001", n: "龙头A", fbt: 93000, lbc: 2, hybk: "算力" },
      { c: "600002", n: "跟风B", fbt: 93500, lbc: 1, hybk: "算力" },
      { c: "600003", n: "孤票C", fbt: 94000, lbc: 1, hybk: "其他" },
    ];
    const out = findAuctionOpportunities(pool, []);
    expect(out).toHaveLength(1);
    expect(out[0].board).toBe("算力");
    expect(out[0].ztCount).toBe(2);
  });

  it("③ 龙头=最高板；同板取首封最早", () => {
    const pool = [
      { c: "600001", n: "甲", fbt: 93500, lbc: 1, hybk: "算力" },
      { c: "600002", n: "乙", fbt: 93200, lbc: 1, hybk: "算力" },
    ];
    const out = findAuctionOpportunities(pool, []);
    expect(out[0].leader?.name).toBe("乙"); // 同板取首封最早
    expect(out[0].followers).toHaveLength(1);
  });

  it("⑤ 排除一字板：首封≤09:25 或竞价封板不入龙头/跟风，记入 excludedOneWord", () => {
    const pool = [
      { c: "600001", n: "一字龙", fbt: 92500, lbc: 3, hybk: "算力" },
      { c: "600002", n: "换手龙", fbt: 100000, lbc: 2, hybk: "算力" },
    ];
    const out = findAuctionOpportunities(pool, []);
    expect(out[0].excludedOneWord).toContain("一字龙");
    expect(out[0].leader?.name).toBe("换手龙");
    // 竞价封板同样排除
    const out2 = findAuctionOpportunities(
      [{ c: "600001", n: "封板A", fbt: 100000, lbc: 2, hybk: "算力" }, { c: "600002", n: "B", fbt: 100100, lbc: 1, hybk: "算力" }],
      [mkQuote({ code: "600001", name: "封板A", auctionLimitUp: true, auctionPct: 10 })],
    );
    expect(out2[0].excludedOneWord).toContain("封板A");
  });

  it("④ 未涨停+套利空间：候选不在今日涨停池，板块映射来自 prevHybk（昨日快照）——生产形状", () => {
    const pool = [
      { c: "600001", n: "龙", fbt: 93000, lbc: 2, hybk: "算力" },
      { c: "600002", n: "跟", fbt: 93500, lbc: 1, hybk: "算力" },
    ];
    // 生产真实形状：昨日涨停股今日未涨停 → 不在今日池；板块归属靠昨日快照 hybk
    const quotes = [
      mkQuote({ code: "600101", name: "低吸候选", auctionPct: 2.5, openAmountYi: 0.8 }),   // 昨日涨停·今未涨停·同板块
      mkQuote({ code: "600102", name: "竞价过高", auctionPct: 8.5, openAmountYi: 1.2 }),    // >7% 排除
      mkQuote({ code: "600103", name: "竞价太低", auctionPct: 0.2, openAmountYi: 0.5 }),    // <0.5% 排除
      mkQuote({ code: "600104", name: "量能不足", auctionPct: 3, openAmountYi: 0.1 }),      // 竞价额<0.3 排除
      mkQuote({ code: "600105", name: "异板块", auctionPct: 3, openAmountYi: 1 }),          // 板块不符排除
    ];
    const prevHybk = new Map([
      ["600101", "算力"], ["600102", "算力"], ["600103", "算力"], ["600104", "算力"], ["600105", "医药"],
    ]);
    const out = findAuctionOpportunities(pool, quotes, {}, prevHybk);
    expect(out[0].candidates).toHaveLength(1);
    expect(out[0].candidates[0].name).toBe("低吸候选");
  });

  it("无有效板块（全为独立行情）→ 空数组", () => {
    const pool = [{ c: "600001", n: "A", fbt: 93000, lbc: 1, hybk: "甲" }, { c: "600002", n: "B", fbt: 93000, lbc: 1, hybk: "乙" }];
    expect(findAuctionOpportunities(pool, [])).toEqual([]);
    expect(findAuctionOpportunities([], [])).toEqual([]);
  });

  it("排序：涨停家数降序", () => {
    const pool = [
      { c: "1", n: "a", fbt: 93000, lbc: 1, hybk: "小板块" },
      { c: "2", n: "b", fbt: 93000, lbc: 1, hybk: "小板块" },
      { c: "3", n: "c", fbt: 93000, lbc: 1, hybk: "大板块" },
      { c: "4", n: "d", fbt: 93000, lbc: 1, hybk: "大板块" },
      { c: "5", n: "e", fbt: 93000, lbc: 1, hybk: "大板块" },
    ];
    const out = findAuctionOpportunities(pool, []);
    expect(out[0].board).toBe("大板块");
  });
});

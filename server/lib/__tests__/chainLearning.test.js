// v9.148.1（T4 P1-2）：chainLearning 交易日锚定单测 —— 窗口正确/日历不足跳过/幂等
// db.js 无 DATABASE_URL 会 exit → vi.hoisted 注入
import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/stock_monitor";
});

import { chainStockAvgPct, recordChainHit, tradingCalendarAfter } from "../chainLearning";

/** mock db：kline_daily 按日期提供收盘价；日历由 dates 数组驱动 */
function makeDb({ dates, closesByDate = {}, briefingRows = [] } = {}) {
  return {
    query: vi.fn(async (sql, params) => {
      if (sql.includes("SELECT DISTINCT date FROM kline_daily")) {
        const from = params[0];
        const need = Number(params[1]) || 6;
        const rows = dates.filter((d) => d >= from).slice(0, need).map((d) => ({ date: d }));
        return { rows };
      }
      if (sql.includes("date IN ($2, $3)")) {
        const d0 = params[1], dN = params[2];
        const codes = params[0];
        return { rows: codes.map((c) => ({
          code: c,
          base_close: closesByDate[d0] ?? 100,
          last_close: closesByDate[dN] ?? 110,
        })) };
      }
      if (sql.includes("FROM chain_briefing")) return { rows: briefingRows };
      if (sql.includes("INSERT INTO kv_store")) return { rows: [] };
      if (sql.includes("SELECT code, concepts FROM stock_concepts")) return { rows: [{ code: "600519", concepts: [] }] };
      return { rows: [] };
    }),
  };
}

describe("tradingCalendarAfter / chainStockAvgPct（交易日锚定）", () => {
  it("简报日后第 1 与第 6 个交易日收盘差（10 交易日序列正确锚定）", async () => {
    const dates = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14",
                   "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"];
    const db = makeDb({ dates, closesByDate: { "2026-08-10": 100, "2026-08-17": 103 } });
    // 简报日 08-10：base=08-10(100)，last=第 6 个交易日 08-17(103) → +3%
    const r = await chainStockAvgPct(db, "semiconductor", "2026-08-10", 5);
    expect(r.avgPct).toBe(3);
    expect(r.sampleCount).toBe(8); // 7 种子 + 1 概念命中
  });

  it("日历不足 6 个交易日 → 返回 null（不写脏数据）", async () => {
    const db = makeDb({ dates: ["2026-08-10", "2026-08-11", "2026-08-12"], closesByDate: {} });
    const r = await chainStockAvgPct(db, "semiconductor", "2026-08-10", 5);
    expect(r).toBeNull();
  });
});

describe("recordChainHit 幂等与门槛", () => {
  it("简报日后交易日不足 → 跳过（返回 null，不写 kv）", async () => {
    const db = makeDb({ dates: ["2026-08-14"], briefingRows: [{ briefing_date: "2026-08-14", content: { stage: "加速" } }] });
    const r = await recordChainHit(db, "semiconductor");
    expect(r).toBeNull();
    // 无 INSERT 调用
    expect(db.query.mock.calls.some((c) => c[0].includes("INSERT INTO kv_store"))).toBe(false);
  });

  it("交易日充足 → 回填落库且值正确（重复跑不重复错）", async () => {
    const dates = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14",
                   "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"];
    const db = makeDb({ dates, closesByDate: { "2026-08-10": 100, "2026-08-17": 105 },
      briefingRows: [{ briefing_date: "2026-08-10", content: { stage: "加速" } }] });
    const r = await recordChainHit(db, "semiconductor");
    expect(r.date).toBe("2026-08-10");
    expect(r.stage).toBe("加速");
    expect(r.avgPct).toBe(5);
    // 幂等：ON CONFLICT 更新同一 key
    const insert = db.query.mock.calls.find((c) => c[0].includes("INSERT INTO kv_store"));
    expect(insert[1][0]).toBe("chain_hit:semiconductor:2026-08-10");
  });
});

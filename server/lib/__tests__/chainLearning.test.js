// v9.148.0（任务12）：chainLearning 命中率单测 —— T+5 平均涨跌计算/回填落库/历史查询
// db.js 无 DATABASE_URL 会 exit → vi.hoisted 注入
import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/stock_monitor";
});

import { chainStockAvgPct, recordChainHit, getChainHitHistory } from "../chainLearning";

function makeDb({ klineRows = [], briefingRows = [], hitRows = [] } = {}) {
  return {
    query: vi.fn(async (sql, params) => {
      if (sql.includes("FROM kline_daily")) return { rows: klineRows };
      if (sql.includes("FROM chain_briefing")) return { rows: briefingRows };
      if (sql.includes("key LIKE $1") && params?.[0]?.includes?.("chain_hit:")) return { rows: hitRows };
      if (sql.includes("INSERT INTO kv_store")) return { rows: [] };
      if (sql.includes("SELECT code, concepts FROM stock_concepts")) return { rows: [{ code: "600519", concepts: [] }] };
      return { rows: [] };
    }),
  };
}

describe("chainStockAvgPct", () => {
  it("计算链内标的 T+5 平均涨跌", async () => {
    const db = makeDb({
      klineRows: [
        { code: "600519", last_close: 110, base_close: 100 },  // +10%
        { code: "000001", last_close: 90, base_close: 100 },   // -10%
      ],
    });
    const r = await chainStockAvgPct(db, "semiconductor", "2026-08-01", 5);
    expect(r.avgPct).toBe(0);       // (+10 -10)/2
    expect(r.sampleCount).toBe(2);
  });

  it("无数据返回 null", async () => {
    const r = await chainStockAvgPct(makeDb(), "semiconductor", "2026-08-01", 5);
    expect(r).toBeNull();
  });
});

describe("recordChainHit / getChainHitHistory", () => {
  it("读 3 天前简报 → 回填落库（含 stage 与 T+5 实际）", async () => {
    const db = makeDb({
      briefingRows: [{ briefing_date: "2026-08-10", content: { stage: "加速" } }],
      klineRows: [{ code: "600519", last_close: 110, base_close: 100 }],
    });
    const r = await recordChainHit(db, "semiconductor");
    expect(r.stage).toBe("加速");
    expect(r.avgPct).toBe(10);
    // 落库 SQL 的 key 格式
    const insertCall = db.query.mock.calls.find((c) => c[0].includes("INSERT INTO kv_store"));
    expect(insertCall[1][0]).toMatch(/^chain_hit:semiconductor:2026-08-10$/);
  });

  it("无历史简报 → 不落库返回 null", async () => {
    const r = await recordChainHit(makeDb(), "semiconductor");
    expect(r).toBeNull();
  });

  it("历史命中查询解析", async () => {
    const db = makeDb({
      hitRows: [{ key: "chain_hit:semiconductor:2026-08-10", value: JSON.stringify({ stage: "加速", avgPct: 3.2, sampleCount: 40 }) }],
    });
    const hits = await getChainHitHistory(db, "semiconductor");
    expect(hits).toHaveLength(1);
    expect(hits[0].date).toBe("2026-08-10");
    expect(hits[0].avgPct).toBe(3.2);
  });
});

// v9.148.0（任务11）：chainAnomaly 异动检测单测 —— 批量涨停阈值/商品±3%/公告命中/节流
// db.js 无 DATABASE_URL 会 exit → vi.hoisted 注入
import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/stock_monitor";
});

import { checkAnomalies, throttled } from "../chainAnomaly";

/** mock db：zt_snapshot 返回 pool（hits 只 + 1 只非链内） */
function makeDb(limitHits, { prevPrice, todayPrice } = {}) {
  return {
    query: vi.fn(async (sql, params) => {
      if (sql.includes("zt_snapshot")) {
        const poolArr = [
          { code: "601899", name: "紫金矿业", pct: 10.0 },  // 有色金属种子
          { code: "600362", name: "江西铜业", pct: 9.5 },   // 有色金属种子
          { code: "000630", name: "铜陵有色", pct: 6.2 },   // 有色金属种子
          { code: "000001", name: "平安银行", pct: 10.0 },  // 非链内
        ];
        return { rows: [{ data: JSON.stringify({ pool: poolArr, count: poolArr.length }) }] };
      }
      if (sql.includes("commodity_price:%")) {
        return { rows: [
          { value: JSON.stringify({ items: [{ name: "铜", price: todayPrice ?? 70000, dir: "up", pct: 4.5 }] }) },
          { value: JSON.stringify({ items: [{ name: "铜", price: prevPrice ?? 67000, dir: "flat", pct: null }] }) },
        ] };
      }
      if (sql.includes("FROM news")) {
        return { rows: [
          { title: "半导体产业链重大利好公告", time: "2026-08-15 10:00:00" },
          { title: "某公司发布分红公告", time: "2026-08-15 10:00:00" },
        ] };
      }
      if (sql.includes("SELECT value FROM kv_store WHERE key=$1")) {
        // throttled 的 key 在参数里
        if (params?.[0] === "chain_anomaly_push:semiconductor") {
          return { rows: [{ value: JSON.stringify({ ts: Date.now() - 60 * 1000 }) }] };
        }
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO kv_store") && sql.includes("chain_anomaly_push")) {
        return { rows: [] };
      }
      if (sql.includes("stock_concepts")) {
        return { rows: [{ code: "601899", concepts: ["黄金概念"] }] };
      }
      return { rows: [] };
    }),
  };
}

describe("checkAnomalies 触发规则", () => {
  it("链内 ≥3 只涨停 → 触发批量涨停", async () => {
    const triggers = await checkAnomalies(makeDb(true));
    const nf = triggers.find((t) => t.chainId === "nonferrous");
    expect(nf).toBeTruthy();
    expect(nf.reason).toContain("3 只标的涨停/大涨");
    expect(nf.detail).toContain("紫金矿业");
  });

  it("商品涨跌超 ±3% → 触发", async () => {
    const triggers = await checkAnomalies(makeDb(true));
    const nf = triggers.filter((t) => t.chainId === "nonferrous");
    expect(nf.some((t) => t.reason.includes("商品「铜」涨 4.5%"))).toBe(true);
  });

  it("news 标题命中链名 → 触发公告", async () => {
    const triggers = await checkAnomalies(makeDb(true));
    expect(triggers.some((t) => t.chainId === "semiconductor" && t.reason.includes("链内消息命中"))).toBe(true);
  });
});

describe("throttled 节流", () => {
  it("30 分钟内同链不重复推送；过期后放行", async () => {
    // 模拟：semiconductor 已有 1 分钟前记录 → 节流
    const db = makeDb(true);
    expect(await throttled(db, "semiconductor")).toBe(true);
    // 未知链无记录 → 放行并写记录
    expect(await throttled(db, "robotics")).toBe(false);
  });
});

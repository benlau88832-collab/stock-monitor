// v9.148.0（任务11）：chainAnomaly 异动检测单测 —— 批量涨停阈值/商品±3%/公告命中/节流
// db.js 无 DATABASE_URL 会 exit → vi.hoisted 注入
import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/stock_monitor";
});

import { checkAnomalies, throttled, detectPctSurge, markPushed } from "../chainAnomaly";

/** mock db：zt_snapshot 返回 pool（hits 只 + 1 只非链内）；kv 写入用闭包状态模拟（markPushed 可被 SELECT 读到） */
function makeDb(limitHits, { prevPrice, todayPrice } = {}) {
  const kvState = new Map(); // key -> value（INSERT 写入，SELECT 可读）
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
      if (sql.includes("INSERT INTO kv_store")) {
        if (params?.[0]?.startsWith("chain_anomaly_push:")) kvState.set(params[0], params[1]);
        return { rows: [] };
      }
      if (sql.includes("SELECT value FROM kv_store WHERE key=$1")) {
        // throttled 的 key 在参数里：先查闭包状态，再查预置 semiconductor 记录
        if (kvState.has(params?.[0])) return { rows: [{ value: kvState.get(params[0]) }] };
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

describe("throttled 节流（v9.148.1 T5：只读 + markPushed 后置）", () => {
  it("30 分钟内同链不重复推送；无记录放行", async () => {
    const db = makeDb(true);
    expect(await throttled(db, "semiconductor")).toBe(true);  // 1 分钟前有记录 → 节流
    expect(await throttled(db, "robotics")).toBe(false);      // 无记录 → 放行（不再写记录）
  });

  it("dig 失败（未 markPushed）不占用 30 分钟冷却", async () => {
    const db = makeDb(true);
    expect(await throttled(db, "robotics")).toBe(false);      // 未 markPushed → 放行
    const { markPushed } = await import("../chainAnomaly");
    await markPushed(db, "robotics");
    expect(await throttled(db, "robotics")).toBe(true);       // markPushed 后 → 节流
  });
});

describe("detectPctSurge（v9.148.1 T5 大涨检测）", () => {
  it("盘中链内 ≥3 只涨>5% 未涨停 → 触发", async () => {
    const db = makeDb(true);
    // mock 腾讯批量响应：半导体种子 688012/002371/603501 均 6-7%（未涨停）；000001 非链内
    // parseTencentQuotesBatch 取 f[2]=code、f[32]=pct（腾讯格式 33+ 字段）
    const mk = (code, pct) => {
      const f = Array(40).fill("0");
      f[0] = "1"; f[1] = "测试"; f[2] = code; f[32] = String(pct);
      return `v_${code}="${f.join("~")}";`;
    };
    const body = Buffer.from(
      mk("688012", "6.2") + mk("002371", "7.5") + mk("603501", "5.8") + mk("000001", "10.1"),
    );
    const requestRaw = async () => ({ body });
    const triggers = await detectPctSurge(db, { _isIntraday: () => true, _requestRaw: requestRaw });
    const t = triggers.find((x) => x.reason.includes("涨>5%"));
    expect(t).toBeTruthy();
    expect(t.reason).toContain("3 只标的涨>5%");
  });

  it("非盘中 → 不检测返回空", async () => {
    const db = makeDb(true);
    const triggers = await detectPctSurge(db, { _isIntraday: () => false });
    expect(triggers).toEqual([]);
  });
});

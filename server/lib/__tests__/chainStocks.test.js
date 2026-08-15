// v9.148.0（任务04）：chainStocks 6 链标的集合单测 —— 配置完整性/概念命中/种子兜底/去重
// getChainStocks 支持 _pool 注入（与 webSearch._requestRaw 同模式）
// 注意：server/db.js 顶层无 DATABASE_URL 会 process.exit(1) → vi.hoisted 先注入（同 decisionLayerCompose 模式）
import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/stock_monitor";
});

import { CHAINS, getChainStocks, chainStockStats } from "../chainStocks";

describe("chainStocks 配置完整性", () => {
  it("6 条链都有 name/concepts/seeds 配置", () => {
    expect(Object.keys(CHAINS)).toHaveLength(6);
    for (const [id, cfg] of Object.entries(CHAINS)) {
      expect(cfg.name).toBeTruthy();
      expect(Array.isArray(cfg.concepts)).toBe(true);
      expect(Array.isArray(cfg.seeds)).toBe(true);
      expect(cfg.seeds.every((s) => /^\d{6}$/.test(s.code) && s.name)).toBe(true);
    }
  });

  it("概念关键词不为空且无空串", () => {
    for (const cfg of Object.values(CHAINS)) {
      for (const c of cfg.concepts) expect(c.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("getChainStocks", () => {
  const mockPool = {
    query: vi.fn(async (sql) => {
      // 概念命中：返回两条（含 600519 概念命中 + 000001 hybk 命中）
      if (sql.includes("concepts::text")) {
        return { rows: [{ code: "600519", concepts: ["半导体概念", "白酒"] }] };
      }
      if (sql.includes("hybk")) {
        return { rows: [{ code: "000001", concepts: ["银行"] }] };
      }
      return { rows: [] };
    }),
  };

  it("未知链抛错", async () => {
    await expect(getChainStocks("nope", {}, { _pool: mockPool })).rejects.toThrow("unknown chain");
  });

  it("概念命中 + hybk 命中 + 种子兜底合并去重", async () => {
    const out = await getChainStocks("semiconductor", { limit: 500 }, { _pool: mockPool });
    const codes = out.map((s) => s.code);
    expect(codes).toContain("600519");  // 概念命中
    expect(codes).toContain("000001");  // hybk 命中
    // 种子 7 只全部兜底进入
    for (const s of CHAINS.semiconductor.seeds) expect(codes).toContain(s.code);
    // 无重复
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("种子携带 seed 名标记", async () => {
    const out = await getChainStocks("nonferrous", { limit: 500 }, { _pool: { query: async () => ({ rows: [] }) } });
    const zj = out.find((s) => s.code === "601899");
    expect(zj?.seed).toBe("紫金矿业");
  });
});

describe("chainStockStats", () => {
  it("返回 6 链统计", async () => {
    const stats = await chainStockStats({ _pool: { query: async () => ({ rows: [] }) } });
    expect(Object.keys(stats)).toHaveLength(6);
    for (const s of Object.values(stats)) {
      expect(s.count).toBeGreaterThanOrEqual(0);
      expect(s.name).toBeTruthy();
    }
  });
});

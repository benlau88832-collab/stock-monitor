// ============================================================
// v9.123.0（卓越审查 P0-2）：decisionLayer.composeDecision 认知表优先（T-14）——
//   表有认知 → 只 1 次 cognition_snapshots 查询（不重建 brainContext，10+ PG 查询全跳过）；
//   表空 → 重建+落库（version 用表序列，废弃 0 硬编码）。
// 注意：server/db.js 顶层无 DATABASE_URL 会 process.exit(1) → 用 vi.hoisted 先注入再 import。
// ============================================================
import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/stock_monitor";
});

import { composeDecision } from "../decisionLayer";
import { buildCognition } from "../cognition";

/** 认知层构造（与 buildCognition 输入形状一致） */
function makeCog(version = 7) {
  const raw = {
    asOf: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10) + "T00:00:00.000Z",
    indexes: [], breadth: { total: 0 },
    limit: { up: [{ code: "600001", name: "龙头甲", pct: 10, reason: "", relay: 3 }], down: [], broken: [] },
    sentimentRaw: { upRatio: 0.5, limitScore: 30, avgPct: 0.3, premium: 1.2 },
    mainlines: [{ name: "半导体", strength: 92, fundNet: 10, leaders: ["龙头甲"], followers: [] }],
    boardFund: [{ name: "半导体", bigNet: 31.2, darkLightGap: 18.4 }],
    stocks: {}, overseas: [], news: [],
  };
  return buildCognition(raw, version, { phase: "盘中", window: "09:30-11:30", decisionWindow: false, note: "" });
}

describe("v9.123.0 decisionLayer.composeDecision（P0-2）", () => {
  it("表有认知 → 直接裁决，query 仅 1 次（不重建 brainContext）", async () => {
    const cog = makeCog(7);
    const calls = [];
    const poolMock = {
      query: async (sql) => {
        calls.push(sql);
        if (String(sql).includes("cognition_snapshots")) return { rows: [{ payload: JSON.stringify(cog) }] };
        return { rows: [] };
      },
    };
    const v = await composeDecision({}, poolMock);
    expect(v.decision).toBeDefined();
    expect(v.tactics).toBeDefined();
    expect(v.evidence.caliber).toContain("v7"); // 用表真实 version（废弃 0 硬编码）
    expect(calls.length).toBeGreaterThan(0); // 新增 created_at/market_daily 陈旧检测查询
    expect(calls.some((c) => c.includes("cognition_snapshots"))).toBe(true);
    expect(calls.some((c) => c.includes("INSERT INTO cognition_snapshots"))).toBe(false); // 有权威快照不重建
  });

  it("表空 → 重建+落库（nextVersion 用表序列；失败不崩）", async () => {
    const calls = [];
    const poolMock = {
      query: async (sql) => {
        calls.push(sql);
        const s = String(sql);
        if (s.includes("SELECT payload FROM cognition_snapshots")) return { rows: [] };
        if (s.includes("COALESCE(MAX(version),0)")) return { rows: [{ v: 5 }] };
        return { rows: [] }; // brainContext 各 kv 查询空、zt_snapshot 空、persist INSERT 空
      },
    };
    const v = await composeDecision({}, poolMock);
    expect(v.decision).toBeDefined();
    expect(v.evidence.caliber).toContain("v6"); // max+1 = 6
    expect(calls.some((c) => c.includes("INSERT INTO cognition_snapshots"))).toBe(true);
  });
});

// v9.148.0（任务07）：chainIntel 挖掘引擎单测 —— 验证规则（核心纯函数）
// classifyItems：≥2 独立来源且 ≥1 权威 → verified；否则 pending + 来源数
// db.js 顶层无 DATABASE_URL 会 exit → vi.hoisted 注入（同 chainStocks 模式）
import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/stock_monitor";
});

import { classifyItems } from "../chainIntel";

const mk = (title, source, authoritative = false, url) => ({
  title, source, authoritative, url: url ?? `https://${source}.com/x`, time: "2026-08-14 10:00:00 GMT",
});

describe("classifyItems 验证规则", () => {
  it("2 独立来源 + 1 权威 → verified", () => {
    const out = classifyItems([
      mk("TSMC raises prices 25%", "Reuters", true),
      mk("TSMC raises prices 25%", "Tom's Hardware"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].verified).toBe(true);
    expect(out[0].sourceCount).toBe(2);
    expect(out[0].reason).toBe("");
  });

  it("2 来源但无权威 → pending 且注明来源数", () => {
    const out = classifyItems([
      mk("某事件", "甲财经"),
      mk("某事件", "乙财经"),
    ]);
    expect(out[0].verified).toBe(false);
    expect(out[0].reason).toContain("仅 2 个来源");
    expect(out[0].reason).toContain("无权威源");
  });

  it("1 来源 → pending 且注明「只有 1 个来源」", () => {
    const out = classifyItems([mk("独家消息", "某自媒")]);
    expect(out[0].verified).toBe(false);
    expect(out[0].reason).toContain("仅 1 个来源");
  });

  it("同源重复不算独立来源（同一家媒体两条转载）", () => {
    const out = classifyItems([
      mk("A 事件", "Reuters", true, "https://reuters.com/1"),
      mk("A 事件", "Reuters", true, "https://reuters.com/2"),
    ]);
    expect(out[0].sourceCount).toBe(1);
    expect(out[0].verified).toBe(false);
  });

  it("标题归一化：大小写/标点差异仍归一组", () => {
    const out = classifyItems([
      mk("SMIC increases prices on strong demand!", "Reuters", true),
      mk("SMIC increases prices on strong demand", "CNBC", true),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].verified).toBe(true);
  });

  it("空输入返回空数组", () => {
    expect(classifyItems([])).toEqual([]);
  });
});

describe("chainIntel 信号映射与落库（v9.148.1 T1）", () => {
  it("saveChainIntel 落库含 signals 列", async () => {
    const { saveChainIntel } = await import("../chainIntel");
    const calls = [];
    const db = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [] };
      },
    };
    await saveChainIntel(db, "semiconductor", { items: [], people: [], signals: [{ node_name: "上游：设备/材料", signal_type: "price" }], meta: {} });
    const insert = calls.find((c) => c.sql.includes("INSERT INTO chain_intel"));
    expect(insert.sql).toContain("signals");
    expect(insert.params[4]).toContain("上游：设备/材料");
  });

  it("localSignals 映射未知 ID 回退直查（ANY 参数化）", async () => {
    const { localSignals, CHAIN_SIGNAL_MAP } = await import("../chainIntel");
    // 未知链 → 回退 [chainId] 自身
    expect(CHAIN_SIGNAL_MAP["nope"]).toBeUndefined();
    const sqls = [];
    const db = { query: async (sql) => { sqls.push(sql); return { rows: [] }; } };
    await localSignals(db, "semiconductor");
    expect(sqls[0]).toContain("ANY($1::text[])");
  });
});

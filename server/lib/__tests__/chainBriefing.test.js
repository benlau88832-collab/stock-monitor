// v9.148.0（任务08）：chainBriefing 单测 —— 无情报占位/规则兜底（withLLM:false 不调真实 LLM）
// db.js 无 DATABASE_URL 会 exit → vi.hoisted 注入
import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/stock_monitor";
});

import { generateBriefing } from "../chainBriefing";

/** 模拟 pool：chain_intel 空 → 占位；有情报 → 规则兜底 */
function makePool(hasIntel) {
  const queries = {
    "SELECT items, people, meta FROM chain_intel": hasIntel
      ? { rows: [{ items: [
          { title: "SMIC profit jumps", sources: ["Reuters"], sourceCount: 1, authoritativeCount: 1, singleAuthoritative: true, verified: false },
          { title: "TSMC record revenue", sources: ["Bloomberg.com"], sourceCount: 1, authoritativeCount: 1, singleAuthoritative: true, verified: false },
        ], people: [], meta: {} }] }
      : { rows: [] },
  };
  return {
    query: vi.fn(async (sql) => {
      for (const [k, v] of Object.entries(queries)) if (sql.includes(k)) return v;
      // chain_briefing 读写/chain_intel 昨日简报/价格 → 空
      return { rows: [] };
    }),
  };
}

describe("generateBriefing 兜底路径", () => {
  it("无情报 → 落占位简报（未扫描）", async () => {
    const db = makePool(false);
    const r = await generateBriefing(db, "semiconductor", { withLLM: false });
    expect(r.content.stage).toBe("未扫描");
    expect(r.fallback).toBe(true);
  });

  it("有情报但 LLM 关闭 → 规则兜底：提取单源权威 top 信号", async () => {
    const db = makePool(true);
    const r = await generateBriefing(db, "semiconductor", { withLLM: false });
    expect(r.fallback).toBe(true);
    expect(r.content.keySignals.length).toBeGreaterThan(0);
    // 规则版从情报提取：SMIC 条目应在 keySignals 中
    expect(JSON.stringify(r.content.keySignals)).toContain("SMIC");
  });
});

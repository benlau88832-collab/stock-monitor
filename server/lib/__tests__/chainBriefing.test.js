// v9.148.0（任务08）：chainBriefing 单测 —— 无情报占位/规则兜底（withLLM:false 不调真实 LLM）
// db.js 无 DATABASE_URL 会 exit → vi.hoisted 注入
import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/stock_monitor";
});

import { generateBriefing, verifySignalsAgainstIntel, validateBeneficiaries } from "../chainBriefing";

/** 模拟 pool：chain_intel 空 → 占位；有情报 → 规则兜底 */
function makePool(hasIntel) {
  const queries = {
    "FROM chain_intel": hasIntel
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

describe("verifySignalsAgainstIntel（v9.148.1 T6）", () => {
  const intel = [
    { title: "SMIC Q2 net profit jumps 262%", verified: true, sources: ["Reuters"] },
    { title: "TSMC record revenue", singleAuthoritative: true, sources: ["Bloomberg.com"] },
    { title: "某无关新闻", verified: false, sources: ["某自媒"] },
  ];
  it("LLM verified 且有情报支撑 → 保留 true", () => {
    const out = verifySignalsAgainstIntel(
      [{ text: "SMIC Q2 净利润大增，扩产提价", verified: true }],
      intel,
    );
    expect(out[0].verified).toBe(true);
  });
  it("LLM verified 但情报无支撑 → 降为 false", () => {
    const out = verifySignalsAgainstIntel(
      [{ text: "完全虚构的事件描述，无任何情报对应", verified: true }],
      intel,
    );
    expect(out[0].verified).toBe(false);
  });
  it("非数组/空输入安全", () => {
    expect(verifySignalsAgainstIntel(null, intel)).toEqual([]);
    expect(verifySignalsAgainstIntel([], intel)).toEqual([]);
  });
});

describe("validateBeneficiaries（v9.148.1 T9）", () => {
  it("只保留 A 股个股且 code 在链集合内", () => {
    const out = validateBeneficiaries(
      [
        { name: "中芯国际", code: "688981", reason: "扩产提价", evidence: "SMIC" },
        { name: "铜板块", code: "", reason: "铜价上涨" },
        { name: "电网设备ETF", code: "159326", reason: "ETF" },
        { name: "海外公司", code: "TSMC", reason: "代工" },
        { name: "不在集合的个股", code: "600000", reason: "x" },
      ],
      ["688981", "601899"],
    );
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe("688981");
  });
  it("非数组/空输入安全", () => {
    expect(validateBeneficiaries(null, [])).toEqual([]);
    expect(validateBeneficiaries([], ["600000"])).toEqual([]);
  });
});

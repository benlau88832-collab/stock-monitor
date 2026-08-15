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

describe("verifySignalsAgainstIntel（v9.148.1 T6 → v9.148.2 A4 引用核对）", () => {
  const intel = [
    { idx: 1, title: "SMIC Q2 net profit jumps 262%", verified: true, sourceCount: 2, sources: ["Reuters", "CNBC"] },
    { idx: 2, title: "TSMC record revenue", singleAuthoritative: true, sourceCount: 1, sources: ["Bloomberg.com"] },
    { idx: 3, title: "某无关新闻", verified: false, sourceCount: 1, sources: ["某自媒"] },
  ];
  it("LLM verified 且 titleIds 指向多源条目、文本相关 → 保留 true", () => {
    const out = verifySignalsAgainstIntel(
      [{ text: "SMIC Q2 净利润大增，扩产提价", titleIds: [1], sourceCount: 2, verified: true }],
      intel,
    );
    expect(out[0].verified).toBe(true);
    expect(out[0].titleIds).toEqual([1]);
  });
  it("LLM verified 但无 titleIds 且无多源兜底 → 降为 false（带 downgradeReason）", () => {
    const out = verifySignalsAgainstIntel(
      [{ text: "完全虚构的事件描述，无任何情报对应", verified: true }],
      intel,
    );
    expect(out[0].verified).toBe(false);
    expect(out[0].downgradeReason).toBeTruthy();
  });
  it("非数组/空输入安全", () => {
    expect(verifySignalsAgainstIntel(null, intel)).toEqual([]);
    expect(verifySignalsAgainstIntel([], intel)).toEqual([]);
  });
});

describe("validateBeneficiaries（v9.148.1 T9）", () => {
  it("v9.148.2 A7 放宽：A 股个股保留（链内标 core），ETF/无 code 剔除", () => {
    const out = validateBeneficiaries(
      [
        { name: "中芯国际", code: "688981", reason: "扩产提价", evidence: "SMIC" },
        { name: "链外合法个股", code: "600000", reason: "IDC 概念受益" },
        { name: "电网设备ETF", code: "159326", reason: "ETF" },
        { name: "海外公司", code: "TSMC", reason: "代工" },
        { name: "指数基金", code: "510300", reason: "指数" },
        { name: "铜板块", code: "", reason: "铜价上涨" },
      ],
      ["688981", "601899"],
    );
    expect(out).toHaveLength(2); // 688981 + 600000（链外保留）
    expect(out[0].code).toBe("688981");
    expect(out[0].core).toBe(true);      // 链内 → 核心受益
    expect(out[1].code).toBe("600000");
    expect(out[1].core).toBe(false);     // 链外 → 非核心
  });
  it("非数组/空输入安全", () => {
    expect(validateBeneficiaries(null, [])).toEqual([]);
    expect(validateBeneficiaries([], ["600000"])).toEqual([]);
  });
});

describe("verifySignalsAgainstIntel 引用核对（v9.148.2 A4）", () => {
  const intel = [
    { idx: 1, title: "TSMC raises prices by 25%", verified: true, sourceCount: 2, sources: ["Reuters", "Bloomberg.com"] },
    { idx: 2, title: "TSMC cuts production forecast", verified: true, sourceCount: 2, sources: ["Reuters", "CNBC"] },
    { idx: 3, title: "某单源新闻", verified: false, sourceCount: 1, sources: ["某自媒"] },
  ];
  it("titleIds 指向 2 源多源条目 → 保留 verified", () => {
    const out = verifySignalsAgainstIntel(
      [{ text: "TSMC 提价 25%", titleIds: [1], sourceCount: 2, verified: true }],
      intel,
    );
    expect(out[0].verified).toBe(true);
    expect(out[0].titleIds).toEqual([1]);
  });
  it("反例：TSMC 提薪支撑不了 TSMC 减产（titleIds 指向无关多源条目也降级——按引用语义，指了就必须是支撑）", () => {
    // LLM 声称 verified 且 titleIds=[1]（提价），但文本说的是减产 → 引用与文本不符，靠 bigram 兜底也低 → 降级
    const out = verifySignalsAgainstIntel(
      [{ text: "TSMC 削减产量预测", titleIds: [1], sourceCount: 2, verified: true }],
      intel,
    );
    expect(out[0].verified).toBe(false);
    expect(out[0].downgradeReason).toBeTruthy();
  });
  it("titleIds 指向单源条目 → 降级（防单源写成多源）", () => {
    const out = verifySignalsAgainstIntel(
      [{ text: "某单源新闻内容", titleIds: [3], sourceCount: 2, verified: true }],
      intel,
    );
    expect(out[0].verified).toBe(false);
  });
});

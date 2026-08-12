// v9.115.0（S1-1/S1-2）：认知层纯函数单测 —— buildCognition/verifyCognition/hash/口径/闸门/落库
import { describe, it, expect } from "vitest";
import { buildCognition, verifyCognition, hashString, rawFromBrainContext, nextVersion, persistCognition } from "../cognition";

// 演示原始快照（口径与参考实现 mockData 一致；不带 _pg → 走公式口径）
function mockRaw(over = {}) {
  return {
    asOf: "2026-08-13T10:18:00+08:00",
    indexes: [],
    breadth: { up: 3120, down: 1620, flat: 180, total: 4920 },
    limit: {
      up: [
        { code: "300001", name: "光刻胶龙头A", pct: 20, reason: "国产光刻胶突破", relay: 3 },
        { code: "600002", name: "算力基建B", pct: 10, reason: "国产算力订单", relay: 2 },
        { code: "002003", name: "卫星互联网C", pct: 10, reason: "星座组网催化", relay: 1 },
      ],
      down: [{ code: "600099", name: "退市预警股", pct: -10, reason: "立案调查", relay: 0 }],
      broken: [{ code: "002010", name: "消费跟风F", pct: 6.4, reason: "炸板回封失败", relay: 0 }],
    },
    sentimentRaw: { upRatio: 0.63, limitScore: 78, avgPct: 0.91, premium: 2.4 },
    mainlines: [
      { name: "半导体设备/光刻胶", strength: 92, fundNet: 48.6, leaders: ["光刻胶龙头A"], followers: ["材料跟风G"] },
      { name: "国产算力", strength: 85, fundNet: 35.2, leaders: ["算力基建B"], followers: ["光模块I"] },
      { name: "卫星互联网/低空", strength: 71, fundNet: 22.8, leaders: ["卫星互联网C"], followers: ["通信K"] },
    ],
    boardFund: [
      { name: "半导体", bigNet: 31.2, darkLightGap: 18.4, signal: "吸筹" },
      { name: "计算机/算力", bigNet: 24.1, darkLightGap: 12.6, signal: "吸筹" },
      { name: "国防军工", bigNet: 9.8, darkLightGap: 4.1, signal: "中性" },
      { name: "食品饮料", bigNet: -12.4, darkLightGap: -6.2, signal: "出货" },
    ],
    stocks: {},
    overseas: [],
    news: [],
    ...over,
  };
}

describe("v9.115.0 认知层 buildCognition（S1-1）", () => {
  it("① 同输入产出相同 hash（纯函数确定性）", () => {
    const a = buildCognition(mockRaw(), 1);
    const b = buildCognition(mockRaw(), 1);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{8}$/);
    // 不同 version → 不同 hash（内容含版本号）
    const c = buildCognition(mockRaw(), 2);
    expect(c.hash).not.toBe(a.hash);
  });

  it("② score 口径 = upRatio*40 + limitScore*1.3 + avgPct*0.8 + 20", () => {
    const raw = mockRaw();
    const { score } = buildCognition(raw, 1).sentiment.value;
    const expectScore = Math.round(0.63 * 40 + 78 * 1.3 + 0.91 * 0.8 + 20);
    expect(score).toBe(expectScore);
  });

  it("③ premium<0 时 stage 落入 退潮/分歧", () => {
    const raw = mockRaw({ sentimentRaw: { upRatio: 0.4, limitScore: 30, avgPct: -0.5, premium: -1.8 } });
    const stage = buildCognition(raw, 1).sentiment.value.stage;
    expect(["退潮", "分歧"]).toContain(stage);
  });

  it("④ gateOpen 在 level=极高 时为 false", () => {
    // 三 trap 齐发 → 极高 → 闸门关闭
    const raw = mockRaw({
      sentimentRaw: { upRatio: 0.3, limitScore: 10, avgPct: -1.2, premium: -3.0 },
      limit: { up: [], down: [], broken: [{ code: "x", name: "b", pct: 0, reason: "", relay: 0 }, { code: "y", name: "c", pct: 0, reason: "", relay: 0 }] },
      boardFund: [{ name: "食品", bigNet: -5, darkLightGap: -3, signal: "出货" }],
    });
    const cog = buildCognition(raw, 1);
    expect(cog.risk.value.level).toBe("极高");
    expect(cog.risk.value.gateOpen).toBe(false);
  });

  it("verifyCognition：hash 匹配 → true；不匹配 → false", () => {
    const cog = buildCognition(mockRaw(), 1);
    expect(verifyCognition(cog, cog.hash)).toBe(true);
    expect(verifyCognition(cog, "deadbeef")).toBe(false);
    expect(verifyCognition(null, "x")).toBe(false);
  });

  it("真实适配层 rawFromBrainContext：PG 落库 sentiment 优先（无 _pg 时公式口径）", () => {
    const ctx = {
      date: "2026-08-12",
      fallbackDate: null,
      sources: { market: 1786540636304, sentiment: 1786540775159 },
      market: { ztCount: 92, zbCount: 13, dtCount: 0, blastedRate: 12.4, maxBoardHeight: 7, premiumAvg: 1.2, promotionRate: 0.35, sentiment: 16 },
      limitLadder: {
        total: 92, maxBoard: 7,
        ladder: [{ code: "600001", name: "甲", lbc: 7, hybk: "AI" }, { code: "600002", name: "乙", lbc: 1, hybk: "机器人" }],
        boards: [], boardCounts: { "7": 1, "1": 91 },
      },
      mainlines: { top: [{ theme: "半导体", heat: 92, picks: [{ name: "甲" }, { name: "乙" }] }] },
      boardFund: { items: [{ board: "半导体", mainNet: 31.2 }] },
      lhb: { items: [] }, blackSwans: [], events: [], strongNews: [], gate: {},
    };
    const raw = rawFromBrainContext(ctx);
    const cog = buildCognition(raw, 1);
    expect(cog.sentiment.value.score).toBe(16); // PG 落库 sentiment 优先
    expect(cog.sentiment.value.premium).toBe(1.2);
    expect(cog.risk.value.traps).not.toContain("炸板率偏高"); // blastedRate 12.4% < 20%
    expect(cog.mainline.value.primaryTheme).toBe("半导体");
    expect(cog.leader.value.name).toBe("甲");
    expect(cog.leader.value.height).toBe(7);
  });

  it("hashString 确定性 + 不同内容不同 hash", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });

  // v9.123.0（卓越审查 P0-3）：明暗盘明细缺失 → 按净额方向诚实输出"流入/流出"（此前恒"中性" → 资金维共振永久哑火）
  it("明暗盘缺失 → signal '流入/流出'；明细齐全保持'吸筹'", () => {
    const rawIn = mockRaw({ boardFund: [{ name: "半导体", bigNet: 31.2 }] });
    expect(buildCognition(rawIn, 1).capital.value.signal).toBe("流入");
    const rawOut = mockRaw({ boardFund: [{ name: "食品", bigNet: -12.4 }] });
    expect(buildCognition(rawOut, 1).capital.value.signal).toBe("流出");
    expect(buildCognition(mockRaw(), 1).capital.value.signal).toBe("吸筹");
  });

  // v9.123.0（卓越审查 P1-1）：session 由调用方注入；缺省保持"盘中"（纯函数兼容旧调用）
  it("注入 session → 竞价 9:25 decisionWindow=true；缺省'盘中'", () => {
    const sess = { phase: "竞价", window: "09:20-09:25 不可撤单", decisionWindow: true, note: "" };
    expect(buildCognition(mockRaw(), 1, sess).session.phase).toBe("竞价");
    expect(buildCognition(mockRaw(), 1, sess).session.decisionWindow).toBe(true);
    expect(buildCognition(mockRaw(), 1).session.phase).toBe("盘中");
  });
});

// v9.115.0（S1-2）：落库 —— mock pool 验证 SQL 与 version 序列（③ 验收：cron tick → 表 +1 行，version 自增）
describe("v9.115.0 认知落库 nextVersion/persistCognition（S1-2）", () => {
  it("nextVersion：表空 → 1；max=5 → 6（单调递增）", async () => {
    const empty = { query: async () => ({ rows: [{ v: 0 }] }) };
    expect(await nextVersion(empty)).toBe(1);
    const has = { query: async () => ({ rows: [{ v: 5 }] }) };
    expect(await nextVersion(has)).toBe(6);
  });

  it("persistCognition：INSERT 八字段（version/hash/as_of/主题/阶段/资金/风险/payload）", async () => {
    const calls = [];
    const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: 42 }] }; } };
    const cog = buildCognition(mockRaw(), 3);
    const id = await persistCognition(pool, cog);
    expect(id).toBe(42);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("INSERT INTO cognition_snapshots");
    expect(calls[0].params[0]).toBe(3);                        // version
    expect(calls[0].params[1]).toBe(cog.hash);                 // hash
    expect(calls[0].params[2]).toBe(cog.asOf);                 // as_of 带横杠
    expect(calls[0].params[3]).toBe("半导体设备/光刻胶");        // primary_theme
    expect(calls[0].params[4]).toBe(cog.sentiment.value.stage); // sentiment_stage
    expect(calls[0].params[5]).toBe(cog.capital.value.signal);  // capital_signal
    expect(calls[0].params[6]).toBe(cog.risk.value.level);      // risk_level
    expect(JSON.parse(calls[0].params[7]).hash).toBe(cog.hash); // payload 完整认知
  });
});

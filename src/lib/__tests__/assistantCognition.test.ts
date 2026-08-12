// v9.115.0（S1-3）：助手注入认知 —— 认知层单行摘要替代市场概述 / 快照长度下降 ≥15% / 失败回退
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../cloudStore", () => ({ isLocalServer: () => true }));

import { buildCognitionNote, buildReasoningNote, buildFullSnapshot, brainContextToText, type BrainContext } from "../assistantAgent";

// 固定 brain stub（全量：市场/涨停板块分布/主线Top3/板块资金/龙虎榜/黑天鹅/强催化/闸门/多源 asOf）
const brain: BrainContext = {
  date: "2026-08-12",
  fallbackDate: null,
  sources: { market: 1786540636304, sentiment: 1786540775159, theme: 1786536678393, fund: 1786540645537, zt: 1786541975806 },
  market: { ztCount: 92, blastedRate: 12.4, maxBoardHeight: 7, premiumAvg: 2.4, sentiment: 75 },
  limitLadder: {
    total: 92, maxBoard: 7,
    ladder: [{ code: "600001", name: "甲", lbc: 7, hybk: "AI" }],
    boards: [{ board: "专用设备", count: 8 }, { board: "通用设备", count: 8 }],
  },
  mainlines: {
    asOf: "2026-08-12T10:00:00",
    top: [
      { theme: "半导体", heat: 92, trend: "持续", verdict: "进攻", action: "低吸", picks: [{ code: "600001", name: "龙头A", correlation: 0.9 }] },
      { theme: "国产算力", heat: 85, trend: "发酵", verdict: "进攻", action: "低吸", picks: [{ code: "600002", name: "龙头B", correlation: 0.8 }] },
    ],
  },
  boardFund: { items: [{ board: "半导体", mainNet: 31.2e8 }, { board: "计算机", mainNet: 24.1e8 }] },
  lhb: { items: [{ code: "600001", name: "甲", netBuy: 1.2e8 }] },
  blackSwans: [{ code: "600099", title: "某公司立案调查", level: "high" }],
  events: [],
  strongNews: [{ code: "600001", name: "甲", title: "重大合同公告", column: "公告", score: 3 }],
  gate: { mode: "normal", factor: 0.8, label: "normal（情绪75·炸板12.4%·最高7板）" },
};

// 固定认知 stub（/api/cognition 返回）
const cog = {
  version: 3,
  hash: "abc12345",
  asOf: "2026-08-12T10:00:00.000Z",
  session: { phase: "盘中", window: "", decisionWindow: false, note: "" },
  mainline: { value: { primaryTheme: "半导体", strength: 92, hotspotRotation: "持续", ladder: { tier1: ["龙头A"], tier2: ["B"], tier3: ["C"] } } },
  sentiment: { value: { stage: "发酵", score: 75, limitScore: 92, blastedRate: 12.4, premium: 2.4 } },
  capital: { value: { signal: "吸筹", netFlow: 48.6, darkVsLight: 18.4 } },
  risk: { value: { level: "低", traps: [], gateOpen: true } },
  leader: { value: { name: "百花医药", code: "600721", height: 7, relayOk: true } },
};

function mockFetch(okCog = true, okBrain = true, okReason = true) {
  global.fetch = vi.fn((url: any) => {
    const u = String(url);
    if (u.includes("/api/cognition")) {
      return okCog ? Promise.resolve({ ok: true, json: async () => cog }) : Promise.resolve({ ok: false });
    }
    if (u.includes("/api/reasoning")) {
      return okReason
        ? Promise.resolve({ ok: true, json: async () => ({ narrative: "市场共振进攻(100分)：主线驱动半导体，资金吸筹、闸门放开、龙头3板。前瞻：炸板率>20% → 高低切。", coherence: { status: "共振进攻" }, forecast: { conditions: [{ iff: "炸板率>20%", then: "高低切" }] } }) })
        : Promise.resolve({ ok: false });
    }
    if (u.includes("/api/brain/context")) {
      return okBrain ? Promise.resolve({ ok: true, json: async () => brain }) : Promise.resolve({ ok: false });
    }
    return Promise.reject(new Error("no mock for " + u));
  }) as unknown as typeof fetch;
}

beforeEach(() => mockFetch());

describe("v9.115.0 助手注入认知（S1-3）", () => {
  it("buildCognitionNote：含认知字段（version/hash/情绪/涨停/龙头数字）", async () => {
    const note = await buildCognitionNote();
    expect(note).not.toBeNull();
    expect(note!).toContain("认知层 v3");
    expect(note!).toContain("hash abc12345");
    expect(note!).toContain("情绪75分(发酵)");
    expect(note!).toContain("涨停92只");
    expect(note!).toContain("炸板率12.4%");
    expect(note!).toContain("龙头百花医药(7板·接力可)");
    expect(note!).toContain("闸门放开");
  });

  it("③ 验收：注入认知后快照长度下降 ≥15%（认知行 vs 旧全量市场概述段）", async () => {
    const oldFull = brainContextToText(brain); // 旧版全量（含市场概述/主线Top3/板块资金/龙虎榜/数据截至）
    const snap = await buildFullSnapshot({});
    const cogLine = snap.split("\n")[0];
    expect(cogLine).toContain("认知层");
    // 认知行（单行）必须显著短于旧全量段（多行市场概述）—— ≥15% 是验收下限，实际应 >50%
    expect(cogLine.length).toBeLessThan(oldFull.length * 0.85);
    // 认知未覆盖段仍保留（黑天鹅/强催化/龙虎榜）
    expect(snap).toContain("黑天鹅");
    expect(snap).toContain("公告强催化");
    expect(snap).toContain("龙虎榜");
  });

  it("认知不可用 → 回退原全量快照（含大脑快照段，规则兜底兼容）", async () => {
    mockFetch(false, true);
    const snap = await buildFullSnapshot({});
    expect(snap).toContain("大脑快照");
    expect(snap).toContain("主线Top3"); // 回退路径保留全量
  });

  it("快照行兼容 fallbackAnswer：grab('大脑快照') 可命中认知行", async () => {
    const snap = await buildFullSnapshot({});
    expect(snap.split("\n")[0]).toContain("大脑快照");
  });

  // v9.120.0（卓越 S1-1c）：推理层 narrative 注入助手上下文
  it("buildReasoningNote：含市场理解（narrative + 情景触发）", async () => {
    const note = await buildReasoningNote();
    expect(note).not.toBeNull();
    expect(note!).toContain("市场理解（推理层 v共振进攻）");
    expect(note!).toContain("高低切");
  });

  it("buildFullSnapshot 含推理行（认知行之后）", async () => {
    const snap = await buildFullSnapshot({});
    expect(snap).toContain("市场理解（推理层");
  });

  it("推理端点不可用 → 快照无推理行（静默降级，认知行仍完整）", async () => {
    mockFetch(true, true, false);
    const snap = await buildFullSnapshot({});
    expect(snap).not.toContain("市场理解（推理层");
    expect(snap).toContain("认知层"); // 认知行不受影响
  });
});

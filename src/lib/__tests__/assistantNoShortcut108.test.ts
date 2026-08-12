// v9.108.2（D-5 测试套件）：路由无正则短路回归 + empty content 模拟 + D-2 多源 asOf/延迟/回退
import { describe, it, expect, vi, beforeEach } from "vitest";

// 部分 mock：callAgentChat 可控制，parseAIJSON 保留真实实现
vi.mock("../ai", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../ai")>();
  return { ...orig, callAgentChat: vi.fn() };
});

import { callAgentChat } from "../ai";
import { runAssistantAgent, brainContextToText, type BrainContext } from "../assistantAgent";

const mockCall = callAgentChat as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => { mockCall.mockReset(); });

describe("v9.108.2 runAssistantAgent 路由回归（D-5）", () => {
  it("无正则直出：问题必走 LLM（先调工具再最终答复，证据门通过）", async () => {
    // 第一轮调工具（getLocalNews 本地执行，失败也无妨——calledTools 已计入）→ 第二轮最终答复通过证据门
    mockCall.mockResolvedValueOnce({ text: '{"calls":[{"tool":"getLocalNews","args":{}}]}', toolCalls: [] });
    mockCall.mockResolvedValueOnce({ text: '{"final":{"reply":"LLM 结论：医药主线最强"}}', toolCalls: [] });
    const r = await runAssistantAgent("今日最强主线是什么", {});
    expect(mockCall).toHaveBeenCalledTimes(2); // 至少进入 LLM 轮（无正则短路直出）
    expect(r.degraded).toBe(false);
    expect(r.reply).toContain("医药主线最强");
  });

  it("empty content 模拟：degraded:true 且 reply 非空（规则版兜底）", async () => {
    mockCall.mockResolvedValueOnce({ text: "", toolCalls: [], reason: "model" }); // empty content → reason=model
    const r = await runAssistantAgent("今天情绪如何", {});
    expect(r.degraded).toBe(true);
    expect(r.reply.length).toBeGreaterThan(10); // 永不空白
    expect(r.reply.startsWith("⚠ 规则版")).toBe(true);
  });

  it("LLM 输出非法 JSON（parse 失败）→ 规则版兜底非空", async () => {
    mockCall.mockResolvedValue({ text: "不是JSON", toolCalls: [] });
    const r = await runAssistantAgent("有什么消息", {});
    expect(r.degraded).toBe(true);
    expect(r.reply.length).toBeGreaterThan(10);
  });
});

describe("v9.108.2 brainContextToText 多源 asOf / 延迟 / 回退（D-2）", () => {
  const now = Date.now();
  const brain: BrainContext = {
    date: "2026-08-12",
    fallbackDate: "2026-08-11",
    sources: { market: now - 60 * 1000, theme: now - 2 * 60 * 60 * 1000, fund: now - 5 * 60 * 1000 },
    market: { ztCount: 73, blastedRate: 13, maxBoardHeight: 7, premiumAvg: 3.1, sentiment: 68 },
    mainlines: { asOf: "2026-08-12:1330", top: [{ theme: "医药", heat: 80, trend: "发酵期", verdict: "观望", action: "", picks: [{ code: "600721", name: "百花医药", correlation: 0.9 }] }] },
    gate: { mode: "normal", factor: 0.7, label: "normal（情绪68·炸板13%·最高7板）" },
  };
  it("fallbackDate → 回退标注", () => {
    expect(brainContextToText(brain)).toContain("⚠ 回退历史数据（08-11，今日快照未生成）");
  });
  it("超阈值源（theme 2h 前，盘后 6h 阈值内）→ 无延迟标注；盘中 10min 阈值 → 有", () => {
    // 用盘后阈值（>6h 才算延迟）：2h 前不标延迟
    const txt1 = brainContextToText({ ...brain, sources: { theme: now - 2 * 3600 * 1000 } });
    expect(txt1).toContain("数据截至：主线@");
    // 超 6h（盘后阈值）→ ⚠延迟
    const txt2 = brainContextToText({ ...brain, sources: { theme: now - 7 * 3600 * 1000 } });
    expect(txt2).toContain("⚠延迟");
  });
});

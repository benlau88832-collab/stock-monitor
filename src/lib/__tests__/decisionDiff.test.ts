// P1-2：决策改判解释纯函数测试
import { describe, it, expect, beforeEach } from "vitest";
import { diffLastDecision, diffToText, extractEvidencePhrases } from "../decisionDiff";

function stubLocalStorage() {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: ls, writable: true, configurable: true });
}

beforeEach(() => {
  stubLocalStorage();
  try { localStorage.clear(); } catch { /* skip */ }
});

// 写入一条历史裁决（昨日，AI应用 主线，可上车 80%）
function seedPrevLog() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  localStorage.setItem(`decision_log:${ds}`, JSON.stringify([{
    ts: new Date(d).toISOString(),
    mainline: "AI应用",
    action: "可上车",
    confidence: 80,
    source: "AI-Agent",
    agentReason: "封单1.2亿/成交3亿=40%，主力净流入8000万",
  }]));
}

describe("P1-2 decisionDiff 决策改判解释", () => {
  it("extractEvidencePhrases：提取数字证据短语", () => {
    const phrases = extractEvidencePhrases("封单1.2亿/成交3亿=40%，主力净流入8000万");
    expect(phrases.length).toBeGreaterThan(0);
    expect(phrases.some(p => p.includes("1.2亿"))).toBe(true);
    expect(phrases.some(p => p.includes("8000万"))).toBe(true);
  });

  it("无历史裁决 → changed=false", () => {
    const r = diffLastDecision({ action: "观望", confidence: 60, reason: "分歧加大", mainline: "AI应用" });
    expect(r.changed).toBe(false);
  });

  it("同主线动作变化 → changed=true 且置信差正确", () => {
    seedPrevLog();
    const r = diffLastDecision({ action: "观望", confidence: 55, reason: "炸板率40%攀升", mainline: "AI应用" });
    expect(r.changed).toBe(true);
    expect(r.prevAction).toBe("可上车");
    expect(r.currAction).toBe("观望");
    expect(r.confidenceDelta).toBe(-25);
  });

  it("同主线同动作 → 不视为改判（找不同动作的）", () => {
    seedPrevLog();
    const r = diffLastDecision({ action: "可上车", confidence: 85, reason: "封单更强", mainline: "AI应用" });
    // 同动作 → changed=false（无不同动作历史）
    expect(r.changed).toBe(false);
  });

  it("diffToText：输出含动作变化与置信差", () => {
    seedPrevLog();
    const r = diffLastDecision({ action: "观望", confidence: 55, reason: "炸板率40%攀升", mainline: "AI应用" });
    if (!r.changed) throw new Error("前置条件失败");
    const txt = diffToText(r);
    expect(txt).toContain("可上车");
    expect(txt).toContain("观望");
    expect(txt).toContain("-25");
  });
});
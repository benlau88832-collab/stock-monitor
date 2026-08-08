// P1-1：用户画像纯函数测试
import { describe, it, expect, beforeEach } from "vitest";
import { updateUserProfile, profileToPrompt, loadUserProfile, type UserProfile } from "../userProfile";

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

describe("P1-1 userProfile 用户画像", () => {
  it("无数据时 loadUserProfile 返回 null", () => {
    expect(loadUserProfile()).toBeNull();
  });

  it("空态 updateUserProfile 生成空画像（不抛错）", () => {
    const p = updateUserProfile();
    expect(p.totalPosts).toBe(0);
    expect(p.confirmRate).toBe(0);
    expect(p.lossStreak).toBe(0);
    expect(p.mainlineStats).toEqual({});
  });

  it("有拍板数据后画像统计 confirm 率", () => {
    // 预置 2 条 confirm 1 条 reject 拍板（今日）
    const today = new Date();
    const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const posts = [
      { ticketId: "t1", date: ds, ts: Date.now(), mainline: "AI", code: null, humanAction: "confirm", confidenceAtPost: 80, priceAtPost: null, notes: "", decisionLogRef: null, executed: false, pnl: null },
      { ticketId: "t2", date: ds, ts: Date.now() - 1000, mainline: "AI", code: null, humanAction: "confirm", confidenceAtPost: 75, priceAtPost: null, notes: "", decisionLogRef: null, executed: false, pnl: null },
      { ticketId: "t3", date: ds, ts: Date.now() - 2000, mainline: "AI", code: null, humanAction: "reject", confidenceAtPost: 60, priceAtPost: null, notes: "", decisionLogRef: null, executed: false, pnl: null },
    ];
    localStorage.setItem(`decision_post:${ds}`, JSON.stringify(posts));
    const p = updateUserProfile();
    expect(p.totalPosts).toBe(3);
    expect(p.confirmRate).toBeCloseTo(0.67, 1);
    expect(p.avgConfidence).toBeGreaterThan(0);
  });

  it("profileToPrompt 空画像返回积累中提示", () => {
    expect(profileToPrompt(null)).toContain("积累中");
    expect(profileToPrompt({ totalPosts: 0 } as UserProfile)).toContain("积累中");
  });

  it("profileToPrompt 含连亏提醒（lossStreak≥2）", () => {
    const p: UserProfile = {
      updatedAt: 1, style: "scalper", totalPosts: 10, confirmRate: 0.6, avgConfidence: 75,
      avgPnlT5: -3, recentMaxDrawdown: -8, lossStreak: 2, mainlineStats: {}, riskTendency: -5,
    };
    const txt = profileToPrompt(p);
    expect(txt).toContain("风格");
    expect(txt).toContain("连亏 2 次");
    expect(txt).toContain("平均 T+5 盈亏 -3%");
  });

  it("profileToPrompt 含低胜率题材提示", () => {
    const p: UserProfile = {
      updatedAt: 1, style: "swing", totalPosts: 10, confirmRate: 0.5, avgConfidence: 70,
      avgPnlT5: 2, recentMaxDrawdown: -5, lossStreak: 0,
      mainlineStats: { "AI": { count: 5, avgPnl: -2, winRate: 20 } },
      riskTendency: 0,
    };
    const txt = profileToPrompt(p);
    expect(txt).toContain("历史低胜率题材");
    expect(txt).toContain("AI");
  });
});
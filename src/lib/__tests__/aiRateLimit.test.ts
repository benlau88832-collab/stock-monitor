// v9.85.0（P1-18）：AI 分钟限速滑动窗口测试
// 回归对象：reserveSlot token 单位 bug —— 原 `now*1000+seq` 恒大于淘汰阈值 `now-60000`，
//   滑动窗口永不淘汰 → 成功 10 次后永久"每分钟限速"降级（页面生命周期内不可恢复）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 从 ai.ts 无法直接导入内部函数（未导出），这里做同构最小复刻验证算法修复的正确性
function makeReserveSlot(ratePerMin: number) {
  const recentCalls: number[] = [];
  return {
    reserve(): number | null {
      const now = Date.now();
      while (recentCalls.length > 0 && recentCalls[0] < now - 60_000) recentCalls.shift();
      if (recentCalls.length >= ratePerMin) return null;
      const token = now + (recentCalls.length % 100); // v9.85.0：毫秒级 token（原 now*1000 微秒级 bug）
      recentCalls.push(token);
      return token;
    },
    release(token: number): void {
      const i = recentCalls.indexOf(token);
      if (i >= 0) recentCalls.splice(i, 1);
    },
    size(): number { return recentCalls.length; },
  };
}

describe("AI 分钟限速滑动窗口（v9.85.0 P1-18 回归）", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("10 次成功占满窗口后第 11 次被拒", () => {
    const r = makeReserveSlot(10);
    const tokens: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t = r.reserve();
      expect(t).not.toBeNull();
      tokens.push(t!);
    }
    expect(r.reserve()).toBeNull(); // 满窗拒绝
    expect(r.size()).toBe(10);
  });

  it("60 秒后窗口滑动，可再次占位（修复前：token 永不淘汰 → 永久拒绝）", () => {
    const r = makeReserveSlot(10);
    for (let i = 0; i < 10; i++) r.reserve();
    expect(r.reserve()).toBeNull();

    // 推进 61 秒后再次占位（淘汰逻辑在 reserve 内触发：修复前 recentCalls[0] = now*1000+seq
    // 恒 > now-60000 永不淘汰 → 此处仍返回 null；修复后旧记录被清空、恢复可用）
    vi.setSystemTime(Date.now() + 61_000);
    const t = r.reserve();
    expect(t).not.toBeNull();
    expect(r.size()).toBe(1); // 旧 10 条已淘汰，只剩新占位
  });

  it("释放（失败释放）后立即恢复一个槽位", () => {
    const r = makeReserveSlot(10);
    const tokens: number[] = [];
    for (let i = 0; i < 10; i++) tokens.push(r.reserve()!);
    expect(r.reserve()).toBeNull();
    r.release(tokens[0]);
    expect(r.reserve()).not.toBeNull(); // 释放后立即可占
  });

  it("并发占位 token 唯一（同毫秒多占位不冲突）", () => {
    const r = makeReserveSlot(100);
    const a = r.reserve()!;
    const b = r.reserve()!;
    expect(a).not.toBe(b); // 序号区分同毫秒占位
  });
});

// v9.85.0（P1-18）：AI 分钟限速滑动窗口测试
// 回归对象：reserveSlot token 单位 bug —— 原 `now*1000+seq` 恒大于淘汰阈值 `now-60000`，
//   滑动窗口永不淘汰 → 成功 10 次后永久"每分钟限速"降级（页面生命周期内不可恢复）。
// v9.137.0（审查 P1-10 修复）：改测生产实现 —— 原测试用同构最小复刻（makeReserveSlot）验证算法，
//   测复刻副本不测生产（生产 reserveSlot 回归时测试仍全绿）；现经 __internals 直测 src/lib/ai.ts。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __internals } from "../ai";

const { reserveSlot, releaseSlot, recentCallsLen, AI_RATE_PER_MIN } = __internals;

describe("AI 分钟限速滑动窗口（v9.85.0 P1-18 回归，v9.137.0 直测生产实现）", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("10 次成功占满窗口后第 11 次被拒", () => {
    const tokens: number[] = [];
    for (let i = 0; i < AI_RATE_PER_MIN; i++) {
      const t = reserveSlot();
      expect(t).not.toBeNull();
      tokens.push(t!);
    }
    expect(reserveSlot()).toBeNull(); // 满窗拒绝
    expect(recentCallsLen()).toBe(AI_RATE_PER_MIN);
    // 清理，避免污染其他用例
    for (const t of tokens) releaseSlot(t);
  });

  it("60 秒后窗口滑动，可再次占位（修复前：token 永不淘汰 → 永久拒绝）", () => {
    const tokens: number[] = [];
    for (let i = 0; i < AI_RATE_PER_MIN; i++) tokens.push(reserveSlot()!);
    expect(reserveSlot()).toBeNull();

    // 推进 61 秒后再次占位（淘汰逻辑在 reserve 内触发：修复前 recentCalls[0] = now*1000+seq
    // 恒 > now-60000 永不淘汰 → 此处仍返回 null；修复后旧记录被清空、恢复可用）
    vi.setSystemTime(Date.now() + 61_000);
    const t = reserveSlot();
    expect(t).not.toBeNull();
    expect(recentCallsLen()).toBe(1); // 旧 10 条已淘汰，只剩新占位
    releaseSlot(t!);
  });

  it("释放（失败释放）后立即恢复一个槽位", () => {
    const tokens: number[] = [];
    for (let i = 0; i < AI_RATE_PER_MIN; i++) tokens.push(reserveSlot()!);
    expect(reserveSlot()).toBeNull();
    releaseSlot(tokens[0]);
    expect(reserveSlot()).not.toBeNull(); // 释放后立即可占
    // 清理剩余占位
    const t = reserveSlot();
    if (t != null) releaseSlot(t);
    for (const tk of tokens) releaseSlot(tk);
  });

  it("并发占位 token 唯一（同毫秒多占位不冲突）", () => {
    const a = reserveSlot()!;
    const b = reserveSlot()!;
    expect(a).not.toBe(b); // 序号区分同毫秒占位
    releaseSlot(a); releaseSlot(b);
  });
});

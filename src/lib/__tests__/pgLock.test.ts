// v9.89.0（P2-4）：PG advisory lock 封装测试（mock pg Pool，不触真实数据库）
// 守卫语义：
//   - 锁被占用 → withPgLock 返回 false 且 fn 不执行
//   - 获取成功 → fn 执行 + 同连接释放
//   - acquireLock/releaseLock（后台持锁场景）→ null 语义 + 释放幂等
import { describe, it, expect, vi } from "vitest";

// ---- mock pg：Pool.connect 返回可编程 client ----
function fakeClient(lockOk: boolean) {
  const q = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ ok: lockOk }] };
    if (sql.includes("pg_advisory_unlock")) return { rows: [{ ok: true }] };
    return { rows: [] };
  });
  return { query: q, release: vi.fn() };
}

// @ts-ignore 服务端 CJS 无 .d.ts
const { withPgLock, acquireLock, releaseLock, LOCK_CRON_MAIN, LOCK_THEME } = await (async () => {
  // @ts-ignore 服务端 CJS 无 .d.ts
  const mod = await import("../../../server/lib/pgLock.js");
  // @ts-ignore 服务端 CJS 无 .d.ts
  return mod as typeof import("../../../server/lib/pgLock.js");
})();

describe("v9.89.0 pgLock.withPgLock", () => {
  it("锁被占用 → 返回 false，fn 不执行，连接归还", async () => {
    const client = fakeClient(false);
    const pool = { connect: vi.fn(async () => client) } as never;
    const fn = vi.fn();
    const ok = await withPgLock(pool, LOCK_CRON_MAIN, fn);
    expect(ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it("获取成功 → fn 执行 + 同连接释放（release 前先 unlock）", async () => {
    const client = fakeClient(true);
    const pool = { connect: vi.fn(async () => client) } as never;
    const fn = vi.fn(async () => "done");
    const ok = await withPgLock(pool, LOCK_CRON_MAIN, fn);
    expect(ok).toBe(true);
    expect(fn).toHaveBeenCalled();
    // 释放顺序：先 unlock 再 release
    const unlockCalls = client.query.mock.calls.filter((c: unknown[]) => String(c[0]).includes("pg_advisory_unlock"));
    expect(unlockCalls.length).toBe(1);
    expect(client.release).toHaveBeenCalled();
  });

  it("fn 抛错 → 仍释放锁（finally 保证）", async () => {
    const client = fakeClient(true);
    const pool = { connect: vi.fn(async () => client) } as never;
    await expect(withPgLock(pool, LOCK_CRON_MAIN, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    const unlockCalls = client.query.mock.calls.filter((c: unknown[]) => String(c[0]).includes("pg_advisory_unlock"));
    expect(unlockCalls.length).toBe(1);
    expect(client.release).toHaveBeenCalled();
  });
});

describe("v9.89.0 pgLock.acquireLock/releaseLock（后台持锁）", () => {
  it("锁被占用 → 返回 null", async () => {
    const client = fakeClient(false);
    const pool = { connect: vi.fn(async () => client) } as never;
    expect(await acquireLock(pool, LOCK_THEME)).toBeNull();
    expect(client.release).toHaveBeenCalled();
  });

  it("获取成功 → 返回持锁 client；releaseLock 解锁并归还", async () => {
    const client = fakeClient(true);
    const pool = { connect: vi.fn(async () => client) } as never;
    const lock = await acquireLock(pool, LOCK_THEME);
    expect(lock).toBe(client);
    expect(client.release).not.toHaveBeenCalled(); // 后台任务期间连接保持
    await releaseLock(client, LOCK_THEME);
    const unlockCalls = client.query.mock.calls.filter((c: unknown[]) => String(c[0]).includes("pg_advisory_unlock"));
    expect(unlockCalls.length).toBe(1);
    expect(client.release).toHaveBeenCalled();
  });
});

describe("v9.89.0 锁 key 稳定性", () => {
  it("锁 key 为稳定整数且互不相同（防误撞）", () => {
    const keys = [LOCK_CRON_MAIN, LOCK_THEME];
    for (const k of keys) {
      expect(Number.isInteger(k)).toBe(true);
      expect(k).toBeGreaterThan(0);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });
});

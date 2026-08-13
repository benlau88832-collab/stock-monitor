// lsMigrate.test.ts —— localStorage 版本迁移机制（v9.138.0 阶段二：#19）
import { describe, it, expect, beforeEach } from "vitest";
import { registerMigration, runLocalStorageMigrations, __resetMigrationsForTest, registerBuiltinMigrations } from "../lsMigrate";

// 最小 localStorage stub（vitest node env 默认无 localStorage；需 length/key 供 reset 扫描）
function stubLocalStorage() {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
  Object.defineProperty(globalThis, "localStorage", { value: ls, writable: true, configurable: true });
}

beforeEach(() => {
  stubLocalStorage();
});

describe("lsMigrate 框架", () => {
  it("无戳旧数据 → 升级并打戳；再跑幂等跳过", () => {
    localStorage.setItem("k_v1", JSON.stringify({ a: 1 }));
    registerMigration({ key: "k_v1", fromVersion: 1, toVersion: 2, desc: "t", migrate: (raw) => ({ ...(raw as object), b: 2 }) });
    runLocalStorageMigrations();
    expect(JSON.parse(localStorage.getItem("k_v1")!)).toEqual({ a: 1, b: 2 });
    expect(localStorage.getItem("ls_schema:k_v1")).toBe("2");
    // 幂等：迁移函数不应再次执行（改计数验证）
    let runs = 0;
    registerMigration({ key: "k2_v1", fromVersion: 1, toVersion: 2, desc: "t", migrate: (raw) => { runs++; return raw; } });
    runLocalStorageMigrations(); // k_v1 已是最新（runs 仍 0）；k2 无数据 → 直接打戳不调 migrate
    runLocalStorageMigrations();
    expect(runs).toBe(0);
    expect(localStorage.getItem("ls_schema:k2_v1")).toBe("2");
  });

  it("迁移返回 undefined → 清键（数据不可恢复）", () => {
    localStorage.setItem("bad_v1", "{not json");
    registerMigration({ key: "bad_v1", fromVersion: 1, toVersion: 2, desc: "t", migrate: () => undefined });
    runLocalStorageMigrations();
    expect(localStorage.getItem("bad_v1")).toBeNull();
    expect(localStorage.getItem("ls_schema:bad_v1")).toBe("2");
  });

  it("单键迁移抛错不阻断其他键", () => {
    localStorage.setItem("boom_v1", JSON.stringify([1]));
    localStorage.setItem("ok_v1", JSON.stringify({ x: 0 }));
    registerMigration({ key: "boom_v1", fromVersion: 1, toVersion: 2, desc: "t", migrate: () => { throw new Error("boom"); } });
    registerMigration({ key: "ok_v1", fromVersion: 1, toVersion: 2, desc: "t", migrate: (raw) => ({ ...(raw as object), done: true }) });
    runLocalStorageMigrations();
    expect(JSON.parse(localStorage.getItem("ok_v1")!)).toEqual({ x: 0, done: true });
    expect(localStorage.getItem("ls_schema:boom_v1")).toBeNull(); // 失败键不打戳，下次重试
  });
});

describe("已登记迁移", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetMigrationsForTest();
    registerBuiltinMigrations(); // 清表后重注册（幂等覆盖）
  });

  it("user_profile_v1 → v2：补齐 feedbackStats、非法 style 收敛", () => {
    localStorage.setItem("user_profile_v1", JSON.stringify({ updatedAt: 1, style: "nonsense", totalPosts: 3 }));
    runLocalStorageMigrations();
    const p = JSON.parse(localStorage.getItem("user_profile_v1")!);
    expect(p.style).toBe("swing");
    expect(p.feedbackStats).toEqual({});
    expect(p.updatedAt).toBe(1); // 原字段保留
    expect(localStorage.getItem("ls_schema:user_profile_v1")).toBe("2");
  });

  it("stock_watchlist → v2：去重 + {code} 对象转字符串 + 过滤脏数据", () => {
    localStorage.setItem("stock_watchlist", JSON.stringify(["600519", " 000001 ", { code: "300750" }, { code: "600519" }, "abc123", 42]));
    runLocalStorageMigrations();
    const list = JSON.parse(localStorage.getItem("stock_watchlist")!);
    expect(list).toEqual(["600519", "000001", "300750"]);
    expect(localStorage.getItem("ls_schema:stock_watchlist")).toBe("2");
  });
});

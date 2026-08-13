// ============================================================
// src/lib/lsMigrate.ts —— localStorage 版本迁移机制（v9.138.0 阶段二：#19 落地）
// 背景：审查指出 localStorage 主存无版本迁移机制，schema 变更时旧数据兼容靠各处手写
// try/catch（userProfile 的 {...EMPTY,...p} 合并、ztSnapshot 的字段兼容），
// 改 schema 必须逐个 store 排查 —— 无全局可见的迁移路径。
// 本模块提供 migrateV1→V2 模式：
//   registerMigration(key, fromVersion, toVersion, migrate)  登记一个键的升级路径
//   runLocalStorageMigrations()                              启动时一次性执行全部未应用迁移
// 版本戳存于 `ls_schema:${key}`（值为已应用的版本号），幂等：
//   - 旧数据无戳 → 视为 fromVersion，逐级升级并写回 + 打戳
//   - 已是最新 → 跳过；单键失败 → 记录 console.warn 不阻断其他键
// 新 store 约定：关键键一律带版本后缀（trade_ledger_v1 / user_profile_v1 ...），
// 并在本文件登记首个迁移（作为未来 schema 变更的入口），禁止裸 try/catch 吞 schema 问题。
// ============================================================

export interface LsMigration {
  key: string;          // localStorage 键名
  fromVersion: number;  // 旧版本号（无戳时视为该值）
  toVersion: number;    // 升级后版本号（写回 ls_schema:key）
  migrate: (raw: unknown) => unknown; // 旧值 → 新值（调用方负责类型收窄）
  desc: string;         // 变更说明（审计日志用）
}

const registry: LsMigration[] = [];

/** 登记一个键的迁移路径（module 加载期调用，runLocalStorageMigrations 时统一执行） */
export function registerMigration(m: LsMigration): void {
  registry.push(m);
}

const stampKey = (key: string) => `ls_schema:${key}`;

/** 执行全部已登记且未应用的迁移；幂等、逐键隔离、静默失败（console.warn） */
export function runLocalStorageMigrations(): void {
  if (typeof localStorage === "undefined") return;
  for (const m of registry) {
    try {
      const applied = Number(localStorage.getItem(stampKey(m.key)) ?? m.fromVersion - 1);
      if (applied >= m.toVersion) continue; // 已是最新
      const rawRaw = localStorage.getItem(m.key);
      if (rawRaw == null) { localStorage.setItem(stampKey(m.key), String(m.toVersion)); continue; } // 无数据 → 直接打戳
      const parsed = (() => { try { return JSON.parse(rawRaw); } catch { return undefined; } })();
      const migrated = m.migrate(parsed);
      if (migrated === undefined) { localStorage.removeItem(m.key); } // 迁移判定不可恢复 → 清键（下次按空初始化）
      else localStorage.setItem(m.key, JSON.stringify(migrated));
      localStorage.setItem(stampKey(m.key), String(m.toVersion));
      console.info(`[lsMigrate] ${m.key} v${m.fromVersion}→v${m.toVersion}: ${m.desc}`);
    } catch (e) {
      // 单键迁移失败不阻断其他键（该键保留旧数据，各 store 自带的合并兜底继续生效）
      console.warn(`[lsMigrate] ${m.key} 迁移失败（保留旧数据）:`, e);
    }
  }
}

/** 仅供测试：清空登记表与全部戳（避免测试间串扰） */
export function __resetMigrationsForTest(): void {
  registry.length = 0;
  if (typeof localStorage === "undefined") return;
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("ls_schema:")) stale.push(k);
  }
  for (const k of stale) localStorage.removeItem(k);
}

// ============================================================
// 已登记迁移（每个键首个迁移即未来 schema 变更的入口）
// 封装为函数供 main.tsx 与测试调用（测试需清空登记表后重注册）
// ============================================================

// #1 user_profile_v1 → v2（v9.137.0 引入 feedbackStats 字段；旧数据缺该键时
//  loadUserProfile 的 {...EMPTY,...p} 合并虽能兜底，但存储数据本身不规范 ——
//  迁移补齐默认字段，让存储层数据与类型契约一致）
import { UserProfile, UserStyle } from "./userProfile";
import { loadDisciplineState } from "./discipline";

const PROFILE_STYLES: UserStyle[] = ["longValue", "swing", "scalper", "speculator"];

/** 登记全部内建迁移（幂等：重复调用同 key 会覆盖登记，版本戳保证只执行一次） */
export function registerBuiltinMigrations(): void {
  registerMigration({
    key: "user_profile_v1",
    fromVersion: 1,
    toVersion: 2,
    desc: "补齐 feedbackStats 默认 {}，style 字段非法值收敛为 swing",
    migrate: (raw) => {
      if (raw === undefined || raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
      const p = raw as Partial<UserProfile>;
      const out: Record<string, unknown> = { ...(p as Record<string, unknown>) };
      if (typeof out.feedbackStats !== "object" || out.feedbackStats === null) out.feedbackStats = {};
      if (!PROFILE_STYLES.includes(out.style as UserStyle)) out.style = "swing";
      // 连亏计数与纪律存储对齐（userProfile 曾从 discipline 派生，避免陈旧值）
      try { const d = loadDisciplineState(); if (typeof d?.lossStreak === "number") out.lossStreak = d.lossStreak; } catch { /* 纪律读取失败保持原值 */ }
      return out;
    },
  });

  // #2 stock_watchlist → v2（自选股列表规范化：去重 + 只保留 6 位代码字符串；
  //  防御性处理历史脏数据 —— 老版本可能写入 {code} 对象条目或带空格/小写）
  registerMigration({
    key: "stock_watchlist",
    fromVersion: 1,
    toVersion: 2,
    desc: "自选股列表规范化：去重、过滤非 6 位代码、{code} 对象转字符串",
    migrate: (raw) => {
      if (raw === undefined || raw === null) return [];
      const arr = Array.isArray(raw) ? raw : [raw];
      const out: string[] = [];
      const seen = new Set<string>();
      for (const item of arr) {
        const code = typeof item === "string" ? item.trim() : (typeof item === "object" && item !== null && typeof (item as { code?: unknown }).code === "string" ? (item as { code: string }).code.trim() : "");
        if (!/^\d{6}$/.test(code)) continue;
        if (seen.has(code)) continue;
        seen.add(code);
        out.push(code);
      }
      return out;
    },
  });
}

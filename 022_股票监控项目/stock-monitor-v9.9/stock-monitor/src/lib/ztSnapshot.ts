// 涨停池快照公共模块
// 从 ThemeLadder.tsx 中抽出，供 App 主刷新管道和 ThemeLadder 组件共同使用
// key 格式保持 ztpool:YYYYMMDD，向后兼容已存数据

import type { ZTPoolItem } from "./themeLadder";

const PREFIX = "ztpool:";
const MAX_SNAPSHOTS = 7;

function cacheKey(dateStr: string): string {
  return PREFIX + dateStr;
}

/** 保存当日涨停池快照（瘦身字段仅保留 c/n/lbc/hybk/fbt/amount） */
export function saveZTSnapshot(dateStr: string, pool: ZTPoolItem[]): void {
  try {
    const slim = pool.map((item) => ({
      c: item.c, n: item.n, lbc: item.lbc, hybk: item.hybk,
      fbt: item.fbt, amount: item.amount,
    }));
    localStorage.setItem(cacheKey(dateStr), JSON.stringify(slim));
    cleanOldSnapshots();
  } catch { /* localStorage 满 → 静默 */ }
}

/** 按日期读取快照，异常返回 null */
export function loadZTSnapshot(dateStr: string): ZTPoolItem[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(dateStr));
    if (!raw) return null;
    return JSON.parse(raw) as ZTPoolItem[];
  } catch {
    return null;
  }
}

/** 清理旧快照：按 key 倒序删第 7 个之后的 */
function cleanOldSnapshots(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.sort().reverse();
    for (let i = MAX_SNAPSHOTS; i < keys.length; i++) {
      localStorage.removeItem(keys[i]);
    }
  } catch { /* 静默 */ }
}

/**
 * 加载最近一条历史快照（"昨日"快照）
 * 列出所有 ztpool: key，按日期串倒序排序，
 * 返回日期串小于 todayQdate 的最近一条快照内容。
 * todayQdate 传 null 时退化为返回按日期倒序的第二条（第一条视为今天）。
 * 用"找最近的历史快照"替代"按本地日期推算昨天"，天然兼容法定节假日。
 */
export function loadPrevZTSnapshot(todayQdate: string | null): ZTPoolItem[] | null {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    // 按日期串倒序
    keys.sort().reverse();

    if (todayQdate) {
      // 找日期串 < todayQdate 的最近一条
      for (const k of keys) {
        const dateStr = k.replace(PREFIX, "");
        if (dateStr < todayQdate) {
          return loadZTSnapshot(dateStr);
        }
      }
    } else {
      // todayQdate 为 null → 退化为返回第二条（第一条视为今天）
      if (keys.length >= 2) {
        const dateStr = keys[1].replace(PREFIX, "");
        return loadZTSnapshot(dateStr);
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// v9.55（V7-20）：localStorage 全局用量巡检
// 问题：各 store 各自 prune，跨 store 总量无控制 → 接近 5MB 上限时 setItem 抛
//       QuotaExceeded 被 catch{} 静默吞掉 → 用户无感知丢数据。
// 方案：定期统计总用量；超阈值时按"低价值优先"淘汰（AI 缓存 → 旧快照 → 超期日志），
//       并返回提示文案供 UI 展示。
// ============================================================

/** 警戒线：4.5MB（5MB 上限留余量，避免淘汰滞后导致仍写失败） */
const LIMIT_BYTES = 4.5 * 1024 * 1024;

/** 估算 localStorage 总用量（UTF-16 字符 ×2 字节） */
export function estimateLocalStorageBytes(): number {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = localStorage.getItem(k) ?? "";
      total += (k.length + v.length) * 2;
    }
    return total;
  } catch { return 0; }
}

/** 按 key 判定价值等级（0=最高价值，数字越大越先淘汰） */
function valueRank(key: string): number {
  if (key.startsWith("ai:cache:")) return 3;          // AI 缓存：重算即可，最先淘汰
  if (key.startsWith("ztpool:") || key.startsWith("fund_streak:")) return 2; // 快照：可重抓
  if (key.startsWith("factor_ic:")) return 2; // 因子快照可重算
  // v9.77（A9-5 修复）：decision_log 审计留痕提为 rank1 —— 原 rank2 会在配额清理时最先被删，
  //   机构复盘"AI 为什么这么判"的证据链静默消失；与 decision_post 同级保留
  if (key.startsWith("decision_log:")) return 1;
  // P0：拍板/成交台账是闭环关键数据，比缓存高价值（rank=1 不会被先淘汰）
  if (key.startsWith("decision_post:") || key.startsWith("trade_ledger_v1")) return 1;
  // P0-4：推送设置高价值（用户配的密钥）
  if (key.startsWith("push_settings_v1") || key.startsWith("push_cooldown_v1")) return 1;
  if (key.startsWith("signal_ledger") || key.startsWith("review_diary")) return 1; // 账本：保留
  if (key.startsWith("ai:")) return 2;
  return 1; // 其余（设置/自选股等）最低优先级淘汰
}

/** 优先淘汰"低价值 key"直到低于警戒线；返回清理条数 */
export function pruneLowValueKeys(targetBytes = LIMIT_BYTES): number {
  try {
    const keys: Array<{ key: string; bytes: number; rank: number }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = localStorage.getItem(k) ?? "";
      keys.push({ key: k, bytes: (k.length + v.length) * 2, rank: valueRank(k) });
    }
    keys.sort((a, b) => b.rank - a.rank || b.bytes - a.bytes);
    let used = keys.reduce((s, k) => s + k.bytes, 0);
    let cleaned = 0;
    for (const k of keys) {
      if (used <= targetBytes) break;
      try {
        localStorage.removeItem(k.key);
        used -= k.bytes;
        cleaned++;
      } catch { /* 单项删除失败继续 */ }
    }
    return cleaned;
  } catch { return 0; }
}

/**
 * 全局用量巡检：超警戒 → 自动淘汰 + 返回提示文案；正常 → null
 * 调用：App 启动 + 每小时一次（轻量，O(n)）
 */
export function auditLocalStorageQuota(): { usedMB: number; cleaned: number; message: string | null } {
  const used = estimateLocalStorageBytes();
  if (used < LIMIT_BYTES) {
    return { usedMB: Math.round(used / 1024 / 1024 * 100) / 100, cleaned: 0, message: null };
  }
  const cleaned = pruneLowValueKeys();
  const after = estimateLocalStorageBytes();
  return {
    usedMB: Math.round(after / 1024 / 1024 * 100) / 100,
    cleaned,
    message: `存储已满（${Math.round(used / 1024 / 1024 * 100) / 100}MB），已自动清理 ${cleaned} 项旧数据（AI 缓存/历史快照）`,
  };
}

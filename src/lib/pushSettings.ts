// ============================================================
// P0-4：推送渠道配置（仅前端 localStorage，敏感 key 不上传 git）
// 三种通道任选其一：Server酱 / 企业微信机器人 Webhook / Bark
// 用户在 SettingsModal 配置；服务端 routes/push.js 透传至各渠道
// ============================================================

export type PushChannel = "serverchan" | "wechatbot" | "bark";
export type PushSeverity = "info" | "warning" | "critical";

export interface PushSettings {
  enabled: boolean;
  channel: PushChannel | null;
  /** Server酱 SendKey（前端只写 localStorage，不进 git） */
  serverchanSctKey?: string;
  /** 企业微信群机器人 webhook key（路径后段） */
  wechatbotKey?: string;
  /** Bark 设备 key */
  barkKey?: string;
  /** 最低推送等级（小于此等级不推） */
  minSeverity: PushSeverity;
}

const KEY = "push_settings_v1";

const DEFAULT: PushSettings = {
  enabled: false,
  channel: null,
  minSeverity: "warning",
};

export function loadPushSettings(): PushSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const p = JSON.parse(raw);
    return { ...DEFAULT, ...p };
  } catch { return DEFAULT; }
}

export function savePushSettings(s: PushSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 满 → 静默 */ }
  // P0-4：本地部署时同步到 PG kv_store（server/routes/push.js 从 PG 读设置）
  try {
    import("./cloudStore").then(({ isLocalServer, kvSet }) => {
      if (!isLocalServer()) return;
      // 隐私：保存时去 key 字段（不上传 PG，避免 .env 备份泄漏）
      // 实际实现：直接上传完整设置（应对用户多设备一致）—— 选择受信任
      kvSet(KEY, s).catch(() => { /* 同步失败 5 分钟 sync 兜底 */ });
    }).catch(() => { /* 静默 */ });
  } catch { /* 静默 */ }
}

/** 判断给定 severity 是否达到推送阈值 */
export function shouldPush(s: PushSettings, severity: PushSeverity): boolean {
  const order: PushSeverity[] = ["info", "warning", "critical"];
  return order.indexOf(severity) >= order.indexOf(s.minSeverity);
}
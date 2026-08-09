// ============================================================
// P0-4：外部推送统一网关
// 支持 Server酱 / 企业微信机器人 Webhook / Bark
// 实现：前端 pushMessage → 调本机 server /api/push/send
// 失败静默返回 false；不影响主流程
// 去重：15 分钟内同 title 不重复推（localStorage push_cooldown_v1）
// 线上 GitHub Pages（无 server）→ 静默不推，仅浏览器通知兜底
// ============================================================
import { loadPushSettings, shouldPush, type PushSeverity } from "./pushSettings";
import { isLocalServer } from "./cloudStore";

export interface PushPayload {
  title: string;
  body: string;
  severity: PushSeverity;
}

const COOLDOWN_KEY = "push_cooldown_v1";
const COOLDOWN_MS = 15 * 60 * 1000;

function inCooldown(title: string): boolean {
  try {
    const m = JSON.parse(localStorage.getItem(COOLDOWN_KEY) ?? "{}");
    const ts = m[title] ?? 0;
    return Date.now() - ts < COOLDOWN_MS;
  } catch { return false; }
}

function markCooldown(title: string): void {
  try {
    const m = JSON.parse(localStorage.getItem(COOLDOWN_KEY) ?? "{}");
    m[title] = Date.now();
    // 清过期（>24h）
    for (const k of Object.keys(m)) {
      if (Date.now() - m[k] > 24 * 60 * 60 * 1000) delete m[k];
    }
    localStorage.setItem(COOLDOWN_KEY, JSON.stringify(m));
  } catch { /* skip */ }
}

/**
 * 推送一条消息到用户配置的渠道
 * 失败/未配置/在线版/冷却中 → 返回 false（不抛错）
 */
export async function pushMessage(p: PushPayload): Promise<boolean> {
  const s = loadPushSettings();
  if (!s.enabled || !s.channel) return false;
  if (!shouldPush(s, p.severity)) return false;
  if (inCooldown(p.title)) return false;
  markCooldown(p.title);
  if (!isLocalServer()) return false;  // 线上无 server 静默
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch("/api/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    // v9.80（A3-P1-5 修复）：校验业务结果而非仅 HTTP 状态 ——
    // Server酱/企业微信等渠道"请求发出但业务失败"时返回 HTTP 200 + {ok:false}，
    // 原仅检查 resp.ok 会把失败当成功（发送前已写冷却 → 失败无法重试）
    if (!resp.ok) return false;
    try {
      const j = await resp.json();
      if (j && j.ok === true) return true;
      // {ok:false, skipped:true}（未配置/通道错）与业务失败都返回 false
      return false;
    } catch {
      // 响应不是 JSON（异常）→ 视为失败
      return false;
    }
  } catch { return false; }
}
// 提醒中枢：统一预警发布/订阅/声音/通知/标题闪烁
// 三通道：WebAudio蜂鸣 + 系统通知 + 标题闪烁

// ============== 类型 ==============
export type Severity = "critical" | "warning" | "info";

export interface AlertEvent {
  severity: Severity;
  id: string;
  message: string;
  ts: number; // 时间戳
}

type Listener = (evt: AlertEvent) => void;

// ============== 冷却（可调） ==============
/** 同 id 冷却时间(ms)：15分钟内不重复触发声音/通知 */
const COOLDOWN_MS = 15 * 60 * 1000;

// ============== 内存状态 ==============
const feed: AlertEvent[] = [];
const MAX_FEED = 50;
const listeners: Set<Listener> = new Set();
const cooldownMap = new Map<string, number>(); // id → last trigger ts
let unreadCount = 0;
let flashTimer: ReturnType<typeof setInterval> | null = null;
const originalTitle = typeof document !== "undefined" ? document.title : "";

// ============== 开关持久化 ==============
const SOUND_KEY = "alert_sound_on";
const NOTIFY_KEY = "alert_notify_on";

export function isSoundOn(): boolean {
  try { return localStorage.getItem(SOUND_KEY) === "1"; } catch { return false; }
}
export function isNotifyOn(): boolean {
  try { return localStorage.getItem(NOTIFY_KEY) === "1"; } catch { return false; }
}
export function setSoundOn(on: boolean): void {
  try { localStorage.setItem(SOUND_KEY, on ? "1" : "0"); } catch (e) { console.warn("[alertBus] op failed", e); }
}
export function setNotifyOn(on: boolean): void {
  try { localStorage.setItem(NOTIFY_KEY, on ? "1" : "0"); } catch (e) { console.warn("[alertBus] op failed", e); }
}

// ============== WebAudio 蜂鸣（无音频文件） ==============
let audioCtx: AudioContext | null = null;

function ensureAudioCtx(): AudioContext | null {
  if (!audioCtx && typeof AudioContext !== "undefined") {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

/** 恢复 AudioContext（需用户交互后调用） */
export function resumeAudio(): void {
  const ctx = ensureAudioCtx();
  if (ctx?.state === "suspended") ctx.resume();
}

function beep(freq: number, durationMs: number): void {
  const ctx = ensureAudioCtx();
  if (!ctx || ctx.state !== "running") return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = freq;
  gain.gain.value = 0.15;
  osc.start();
  osc.stop(ctx.currentTime + durationMs / 1000);
}

function playSound(severity: Severity): void {
  if (!isSoundOn()) return;
  // critical: 三连880Hz / warning: 双连660Hz / info: 单声440Hz
  if (severity === "critical") {
    beep(880, 150); setTimeout(() => beep(880, 150), 200); setTimeout(() => beep(880, 150), 400);
  } else if (severity === "warning") {
    beep(660, 150); setTimeout(() => beep(660, 150), 200);
  } else {
    beep(440, 150);
  }
}

// ============== 系统通知 ==============
export function requestNotifyPermission(): void {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function sendNotification(message: string): void {
  if (!isNotifyOn()) return;
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try { new Notification(message); } catch { /* 静默 */ }
  }
}

// ============== 标题闪烁 ==============
function startTitleFlash(): void {
  if (flashTimer) return;
  flashTimer = setInterval(() => {
    if (typeof document === "undefined") return;
    document.title = document.title === originalTitle
      ? `⚠ ${unreadCount}条新提醒`
      : originalTitle;
  }, 1000);
}

function stopTitleFlash(): void {
  if (flashTimer) { clearInterval(flashTimer); flashTimer = null; }
  if (typeof document !== "undefined") document.title = originalTitle;
  unreadCount = 0;
}

// 页面可见时停止闪烁
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) stopTitleFlash();
  });
}

// ============== 核心 API ==============

/** 发布预警事件 */
export function emit(evt: Omit<AlertEvent, "ts">): void {
  const now = Date.now();
  // 冷却去重（最前）：同 id 在窗口内 → 不入流水、不通知，彻底杜绝刷屏
  const lastTrigger = cooldownMap.get(evt.id) ?? 0;
  if (now - lastTrigger < COOLDOWN_MS) return;
  cooldownMap.set(evt.id, now);

  const full: AlertEvent = { ...evt, ts: now };
  feed.unshift(full);
  if (feed.length > MAX_FEED) feed.length = MAX_FEED;
  // 通知所有订阅者
  for (const fn of listeners) {
    try { fn(full); } catch { /* 静默 */ }
  }

  // 声音
  playSound(evt.severity);

  // 系统通知
  sendNotification(evt.message);

  // 标题闪烁（页面不可见时）
  if (typeof document !== "undefined" && document.hidden) {
    unreadCount++;
    startTitleFlash();
  }
}

/** 订阅预警事件，返回取消订阅函数 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 获取流水（内存最近50条） */
export function getFeed(): AlertEvent[] {
  return [...feed];
}

/** 获取未读数 */
export function getUnreadCount(): number {
  return unreadCount;
}

/** 清除未读 */
export function clearUnread(): void {
  stopTitleFlash();
}

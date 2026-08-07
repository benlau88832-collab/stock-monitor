// ============================================================
// v9.65（V2-P2）：数据源双源熔断工具层
// fetchWithFallback：按顺序尝试多个数据源，首个成功即返回；
//   连续失败超过阈值 → 熔断该源一段时间（localStorage 持久化），
//   避免"东财改字段/被 ban"时全站静默失败（配合 hasMissingKeyFields）。
// 用法：
//   const d = await fetchWithFallback("板块资金", [
//     () => fetchBoardFundFlow("market", 60),        // 主源 push2
//     () => fetchBoardFundFlowFallback("market", 60) // 备源（如 gtimg）
//   ]);
// ============================================================
import { recordApiCall } from "./apiHealth";

interface CircuitState {
  failures: number;   // 连续失败次数
  openedUntil: number; // 熔断打开截止时间戳（期间直接跳过该源）
}

const KEY = "data_source_circuit";
const FAIL_THRESHOLD = 3;   // 连续失败 3 次 → 熔断
const OPEN_MS = 10 * 60 * 1000; // 熔断 10 分钟

// 内存态优先（node/测试环境无 localStorage 也能工作），localStorage 仅作持久化兜底
const memState: Record<string, CircuitState> = {};
let loaded = false;
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(memState, JSON.parse(raw) as Record<string, CircuitState>);
  } catch { /* node 无 localStorage → 纯内存态 */ }
}
function loadState(): Record<string, CircuitState> { ensureLoaded(); return memState; }
function saveState(): void {
  try { localStorage.setItem(KEY, JSON.stringify(memState)); } catch { /* 静默 */ }
}

/** 该源当前是否熔断（打开中） */
export function isCircuitOpen(source: string): boolean {
  const s = loadState();
  const c = s[source];
  if (!c) return false;
  if (c.openedUntil && Date.now() < c.openedUntil) return true;
  return false;
}

/** 记录源失败：达到阈值 → 熔断 10 分钟；成功 → 清零 */
export function recordSourceFailure(source: string): void {
  const s = loadState();
  const c = s[source] ?? { failures: 0, openedUntil: 0 };
  c.failures = (c.failures ?? 0) + 1;
  if (c.failures >= FAIL_THRESHOLD) {
    c.openedUntil = Date.now() + OPEN_MS;
    c.failures = 0;
    console.warn(`[dataSource] ${source} 连续失败${FAIL_THRESHOLD}次，熔断 ${OPEN_MS / 60000} 分钟`);
  }
  s[source] = c;
  saveState();
}

export function recordSourceSuccess(source: string): void {
  const s = loadState();
  if (s[source]) { s[source].failures = 0; s[source].openedUntil = 0; saveState(); }
}

/**
 * 双源熔断：按顺序尝试 fetchers，首个成功返回；全失败返回 null（recordApiCall 记录失败）。
 * 熔断中的源直接跳过（省一次超时等待）。
 */
export async function fetchWithFallback<T>(
  name: string,
  fetchers: Array<() => Promise<T>>,
): Promise<T | null> {
  if (fetchers.length === 0) return null;
  const sources = fetchers.map((_, i) => `${name}#${i}`);
  const active: Array<{ fn: () => Promise<T>; src: string }> = [];
  fetchers.forEach((fn, i) => {
    if (!isCircuitOpen(sources[i])) active.push({ fn, src: sources[i] });
  });
  if (active.length === 0) {
    // 全部熔断 → 强制试主源（熔断是"降频"不是"永断"）
    active.push({ fn: fetchers[0], src: sources[0] });
  }
  for (const { fn, src } of active) {
    try {
      const r = await fn();
      if (r == null) { recordSourceFailure(src); continue; }
      recordSourceSuccess(src);
      return r;
    } catch (e) {
      recordSourceFailure(src);
      console.warn(`[dataSource] ${src} 失败:`, e);
    }
  }
  recordApiCall(name, false, 0);
  return null;
}

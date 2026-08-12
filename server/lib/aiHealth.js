// ============================================================
// server/lib/aiHealth.js —— AI 端点健康/自愈熔断（v9.109.2，L-6）
// 按端点记 empty 次数/总次数；连续 N 次 empty → 熔断 M 分钟（llmCore 跳过熔断端点）
// GET /api/ai/health 暴露各端点状态（前端 AIConsole 顶部健康指示 A-2 用）
// ============================================================

const CIRCUIT_EMPTY_THRESHOLD = 3;   // 连续 empty ≥3 次 → 熔断
const CIRCUIT_BREAK_MS = 5 * 60 * 1000; // 熔断 5 分钟（自愈：到期自动半开）

/** endpoint base → { total, emptyStreak, circuitUntil } */
const stats = new Map();

function keyOf(base) {
  return String(base || "");
}

/** 记录一次调用结果（ok=true 成功 / false empty 或失败） */
function recordResult(base, ok) {
  const k = keyOf(base);
  const s = stats.get(k) ?? { total: 0, emptyStreak: 0, circuitUntil: 0 };
  s.total += 1;
  if (ok) {
    s.emptyStreak = 0;
  } else {
    s.emptyStreak += 1;
    if (s.emptyStreak >= CIRCUIT_EMPTY_THRESHOLD) {
      s.circuitUntil = Date.now() + CIRCUIT_BREAK_MS;
      console.warn(`[aiHealth] 端点 ${base} 连续 ${s.emptyStreak} 次 empty → 熔断 ${CIRCUIT_BREAK_MS / 60000} 分钟`);
    }
  }
  stats.set(k, s);
}

/** 端点是否熔断（熔断中返回 true，llmCore 跳过该端点；到期自动半开放行） */
function isCircuitOpen(base) {
  const s = stats.get(keyOf(base));
  if (!s) return false;
  if (s.circuitUntil > Date.now()) return true;
  if (s.circuitUntil > 0 && s.circuitUntil <= Date.now()) {
    // 熔断到期：半开放行，清熔断标记（下次失败重新计数）
    s.circuitUntil = 0;
    s.emptyStreak = 0;
  }
  return false;
}

/** 健康快照（GET /api/ai/health 返回） */
function getHealth() {
  const endpoints = [...stats.entries()].map(([base, s]) => ({
    base,
    ok: s.emptyStreak < CIRCUIT_EMPTY_THRESHOLD && s.circuitUntil <= Date.now(),
    total: s.total,
    emptyRate: s.total > 0 ? Number((s.emptyStreak / s.total).toFixed(3)) : 0,
    circuit: s.circuitUntil > Date.now() ? "open" : "closed",
  }));
  const degraded = endpoints.some(e => !e.ok);
  return { endpoints, degraded, circuitThreshold: CIRCUIT_EMPTY_THRESHOLD, updatedAt: Date.now() };
}

module.exports = { recordResult, isCircuitOpen, getHealth, CIRCUIT_EMPTY_THRESHOLD, _reset: () => stats.clear() };

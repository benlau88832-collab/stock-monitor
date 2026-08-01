// 接口健康遥测：记录每个接口调用的成功率/耗时/最后成功时间
// 用于健康面板展示和"置信度下降"判断

export interface ApiRecord {
  name: string;
  lastCall: number;       // 最后调用时间戳
  lastSuccess: number;    // 最后成功时间戳
  recentCalls: number;    // 近10次调用数
  recentSuccesses: number;// 近10次成功数
  avgMs: number;          // 平均耗时(ms)
}

const records = new Map<string, ApiRecord>();
// 存储每个接口的最近10次调用结果
const history = new Map<string, Array<{ ok: boolean; ms: number; ts: number }>>();

/** 记录一次接口调用结果 */
export function recordApiCall(name: string, success: boolean, durationMs: number) {
  const now = Date.now();
  const hist = history.get(name) ?? [];
  hist.push({ ok: success, ms: durationMs, ts: now });
  // 只保留最近10次
  if (hist.length > 10) hist.shift();
  history.set(name, hist);

  const successes = hist.filter(h => h.ok).length;
  const avgMs = hist.length > 0 ? Math.round(hist.reduce((s, h) => s + h.ms, 0) / hist.length) : 0;

  records.set(name, {
    name,
    lastCall: now,
    lastSuccess: success ? now : (records.get(name)?.lastSuccess ?? 0),
    recentCalls: hist.length,
    recentSuccesses: successes,
    avgMs,
  });
}

/** 获取所有接口的健康状态 */
export function getApiHealth(): ApiRecord[] {
  return [...records.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** 获取整体健康状态：green/yellow/red */
export function getOverallHealth(): "green" | "yellow" | "red" {
  const all = [...records.values()];
  if (all.length === 0) return "green";
  const hasRed = all.some(r => r.recentCalls >= 3 && r.recentSuccesses / r.recentCalls < 0.3);
  const hasYellow = all.some(r => r.recentCalls >= 2 && r.recentSuccesses / r.recentCalls < 0.7);
  if (hasRed) return "red";
  if (hasYellow) return "yellow";
  return "green";
}

/** 格式化"最后成功"为 HH:mm */
export function formatLastSuccess(ts: number): string {
  if (ts === 0) return "从未成功";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

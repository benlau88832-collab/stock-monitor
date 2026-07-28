// 情绪分按交易日冻结存储（替代旧的 prev_sentiment 每60秒覆盖bug）
const PREFIX = "sentiment:";

function todayKey(): string {
  const now = new Date();
  const offset = 8 * 60;
  const local = new Date(now.getTime() + (offset - now.getTimezoneOffset()) * 60000);
  return local.toISOString().slice(0, 10);
}

export function saveTodaySentiment(score: number): void {
  if (score === 50) return;
  localStorage.setItem(PREFIX + todayKey(), String(score));
  localStorage.removeItem("prev_sentiment"); // 清理旧key
}

export function loadPrevTradingDaySentiment(): { score: number; date: string } | null {
  const today = todayKey();
  const d = new Date(today + "T00:00:00+08:00");
  for (let i = 1; i <= 10; i++) {
    const prev = new Date(d.getTime() - i * 86400000);
    if (prev.getDay() === 0 || prev.getDay() === 6) continue;
    const dateStr = prev.toISOString().slice(0, 10);
    const val = localStorage.getItem(PREFIX + dateStr);
    if (val != null) {
      const score = Number(val);
      if (Number.isFinite(score)) return { score, date: dateStr };
    }
  }
  return null;
}

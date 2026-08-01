// 情绪分按交易日冻结存储（替代旧的 prev_sentiment 每60秒覆盖bug）
import { localDateStr, localDateStrOffset } from "./format";
const PREFIX = "sentiment:";

function todayKey(): string { return localDateStr(); }

export function saveTodaySentiment(score: number): void {
  if (score === 50) return;
  localStorage.setItem(PREFIX + todayKey(), String(score));
  localStorage.removeItem("prev_sentiment"); // 清理旧key
}

export function loadPrevTradingDaySentiment(): { score: number; date: string } | null {
  for (let i = 1; i <= 10; i++) {
    const dateStr = localDateStrOffset(i);
    const day = new Date(dateStr + "T00:00:00").getDay();
    if (day === 0 || day === 6) continue;
    const val = localStorage.getItem(PREFIX + dateStr);
    if (val != null) {
      const score = Number(val);
      if (Number.isFinite(score)) return { score, date: dateStr };
    }
  }
  return null;
}

// 每日复盘日志（v9.19-F9）
// 结构化记录：今日主线/龙头/参与个股/盈亏/反思 → 沉淀为个性化打法体系
// 存储：localStorage（v9.20 云端持久化时迁移）
// 设计：游资成长曲线靠复盘笔记喂出来——让 AI 督导后续可针对"反复踩的坑"提醒

// ============== 数据结构 ==============
export interface DailyReview {
  date: string;          // YYYY-MM-DD
  mainline: string;      // 今日主线（如 "AI应用"）
  leader: string;        // 今日龙头
  myStocks: string;      // 我参与的个股（逗号分隔）
  pnl: number | null;    // 当日盈亏%（正=赚）
  reflection: string;    // 一句话反思
  createdAt: number;
}

const REVIEW_KEY = "daily_reviews_v1";

export function loadReviews(): DailyReview[] {
  try {
    const raw = localStorage.getItem(REVIEW_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveReviews(reviews: DailyReview[]): void {
  try {
    // 上限 90 条（3 个月），超出删最旧
    const trimmed = reviews.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 90);
    localStorage.setItem(REVIEW_KEY, JSON.stringify(trimmed));
  } catch { /* 满 → 静默 */ }
}

export function upsertReview(review: DailyReview, all: DailyReview[]): DailyReview[] {
  const rest = all.filter(r => r.date !== review.date);
  return [review, ...rest].sort((a, b) => b.date.localeCompare(a.date));
}

/** 统计连续亏损天数（供冷静期联动） */
export function computeLossStreak(reviews: DailyReview[]): number {
  const sorted = [...reviews].sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;
  for (const r of sorted) {
    if (r.pnl != null && r.pnl < 0) streak++;
    else break;
  }
  return streak;
}

/** 按题材检索 */
export function searchReviews(reviews: DailyReview[], keyword: string): DailyReview[] {
  if (!keyword.trim()) return reviews;
  const k = keyword.trim().toLowerCase();
  return reviews.filter(r =>
    r.mainline.toLowerCase().includes(k) ||
    r.leader.toLowerCase().includes(k) ||
    r.myStocks.toLowerCase().includes(k) ||
    r.reflection.toLowerCase().includes(k)
  );
}

/** 按题材统计（复盘统计：哪类题材我做得最好/最差） */
export function statByMainline(reviews: DailyReview[]): Array<{ mainline: string; count: number; avgPnl: number; winRate: number }> {
  const agg = new Map<string, { count: number; pnlSum: number; wins: number }>();
  for (const r of reviews) {
    if (r.pnl == null || !r.mainline) continue;
    const cur = agg.get(r.mainline) ?? { count: 0, pnlSum: 0, wins: 0 };
    cur.count++;
    cur.pnlSum += r.pnl;
    if (r.pnl > 0) cur.wins++;
    agg.set(r.mainline, cur);
  }
  return [...agg.entries()]
    .map(([mainline, v]) => ({ mainline, count: v.count, avgPnl: Math.round(v.pnlSum / v.count * 100) / 100, winRate: Math.round(v.wins / v.count * 100) }))
    .sort((a, b) => b.count - a.count);
}

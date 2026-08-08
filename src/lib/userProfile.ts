// ============================================================
// P1-1：用户画像 —— "反哺下次决策"闭环的关键
// AI 不再"脸盲"：知道用户风格/历史胜率/禁忌题材/连亏次数
// 数据：localStorage user_profile_v1 + kv:user_profile:YYYY-MM-DD
// 更新时机：每次拍板后轻量更新 + 每日盘后 cron 全量刷新
// 消费方：aiAgent（注入 system prompt）+ DecisionVerdictCard（展示一行）
// ============================================================
import { localDateStr } from "./format";
import { isLocalServer } from "./cloudStore";
import { loadRecentPosts } from "./decisionPost";
import { loadDisciplineState } from "./discipline";

export type UserStyle = "longValue" | "swing" | "scalper" | "speculator";

export interface MainlineStat {
  count: number;
  avgPnl: number | null;
  winRate: number | null;
}

export interface UserProfile {
  updatedAt: number;
  style: UserStyle;
  totalPosts: number;
  confirmRate: number;          // confirm / total (0-1)
  avgConfidence: number;        // 拍板时 AI 置信均值
  avgPnlT5: number | null;      // 平均 T+5 PnL%（来自 tradeLedger 回填）
  recentMaxDrawdown: number | null;
  lossStreak: number;           // 连亏天数（来自 discipline recentPnl）
  mainlineStats: Record<string, MainlineStat>;
  /** 风险偏好：>0 = 用户比 AI 激进（拍板 confirm 时 AI 置信偏低仍拍） */
  riskTendency: number;
}

const KEY = "user_profile_v1";

const EMPTY: UserProfile = {
  updatedAt: 0,
  style: "swing",
  totalPosts: 0,
  confirmRate: 0,
  avgConfidence: 0,
  avgPnlT5: null,
  recentMaxDrawdown: null,
  lossStreak: 0,
  mainlineStats: {},
  riskTendency: 0,
};

export function loadUserProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return { ...EMPTY, ...p };
  } catch { return null; }
}

function saveProfile(p: UserProfile): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* 满 → 静默 */ }
  if (isLocalServer()) {
    try {
      fetch("/api/db/kv", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: `user_profile:${localDateStr()}`, value: JSON.stringify(p) }),
      }).catch(() => {});
    } catch { /* 静默 */ }
  }
}

/** 从拍板/成交/纪律数据刷新画像（幂等，可随时调用） */
export function updateUserProfile(): UserProfile {
  const p: UserProfile = { ...EMPTY, updatedAt: Date.now() };

  // 1. 拍板统计
  const posts = loadRecentPosts(30);
  p.totalPosts = posts.length;
  if (p.totalPosts > 0) {
    const confirms = posts.filter(x => x.humanAction === "confirm").length;
    p.confirmRate = Math.round(confirms / p.totalPosts * 100) / 100;
    const confs = posts.filter(x => x.confidenceAtPost != null).map(x => x.confidenceAtPost!);
    p.avgConfidence = confs.length > 0 ? Math.round(confs.reduce((s, c) => s + c, 0) / confs.length) : 0;
  }

  // 2. 真实盈亏（回填过的拍板）
  const withPnl = posts.filter(x => x.pnl != null && x.pnl !== 0);
  if (withPnl.length > 0) {
    p.avgPnlT5 = Math.round(withPnl.reduce((s, x) => s + (x.pnl ?? 0), 0) / withPnl.length * 10) / 10;
    // 最大回撤：负向最深的单笔
    const worst = Math.min(...withPnl.map(x => x.pnl ?? 0));
    p.recentMaxDrawdown = worst < 0 ? Math.round(worst * 10) / 10 : null;
  }

  // 3. 连亏（来自 discipline）
  try {
    const ds = loadDisciplineState();
    p.lossStreak = ds.lossStreak ?? 0;
    // 4. 题材统计（按拍板 mainline 聚合盈亏）
    const mlMap: Record<string, { count: number; pnlSum: number; wins: number }> = {};
    for (const post of posts) {
      const ml = post.mainline;
      if (!ml) continue;
      const rec = mlMap[ml] ?? { count: 0, pnlSum: 0, wins: 0 };
      rec.count++;
      if (post.pnl != null) { rec.pnlSum += post.pnl; if (post.pnl > 0) rec.wins++; }
      mlMap[ml] = rec;
    }
    for (const [ml, rec] of Object.entries(mlMap)) {
      p.mainlineStats[ml] = {
        count: rec.count,
        avgPnl: rec.count > 0 ? Math.round(rec.pnlSum / rec.count * 10) / 10 : null,
        winRate: rec.count > 0 && rec.pnlSum !== 0 ? Math.round(rec.wins / rec.count * 100) : null,
      };
    }
  } catch { /* discipline 不可用不影响画像主体 */ }

  // 5. 风格推断：confirm 率高 + 持仓天数短 → scalper；confirm 低 → longValue
  if (p.totalPosts >= 5) {
    if (p.confirmRate >= 0.6) p.style = "scalper";
    else if (p.confirmRate >= 0.4) p.style = "swing";
    else p.style = "longValue";
  }

  // 6. 风险偏好：用户拍板 confirm 时的 AI 置信均值 vs 全站 AI 平均（80 基线）
  const confirmConfs = posts.filter(x => x.humanAction === "confirm" && x.confidenceAtPost != null).map(x => x.confidenceAtPost!);
  if (confirmConfs.length >= 3) {
    const avg = confirmConfs.reduce((s, c) => s + c, 0) / confirmConfs.length;
    p.riskTendency = Math.round((avg - 80) * 10) / 10;  // 负 = 比 AI 激进（低置信也拍）
  }

  saveProfile(p);
  return p;
}

/** 生成注入 prompt 的一段用户画像描述 */
export function profileToPrompt(p: UserProfile | null): string {
  if (!p || p.totalPosts === 0) return "（无历史拍板，画像积累中）";
  const styleName: Record<UserStyle, string> = {
    longValue: "长线价值型",
    swing: "波段操作型",
    scalper: "超短打板型",
    speculator: "题材博弈型",
  };
  const parts = [
    `风格：${styleName[p.style]}`,
    `拍板 ${p.totalPosts} 次（确认率 ${Math.round(p.confirmRate * 100)}%，平均置信 ${p.avgConfidence}%）`,
  ];
  if (p.avgPnlT5 != null) parts.push(`平均 T+5 盈亏 ${p.avgPnlT5 > 0 ? "+" : ""}${p.avgPnlT5}%`);
  if (p.lossStreak >= 2) parts.push(`⚠ 已连亏 ${p.lossStreak} 次，建议保守`);
  const worst = Object.entries(p.mainlineStats).filter(([, s]) => s.winRate != null && s.winRate < 40).slice(0, 3).map(([ml]) => ml);
  if (worst.length > 0) parts.push(`历史低胜率题材：${worst.join("、")}`);
  return parts.join("；");
}

/** 便捷：读取画像并生成 prompt（aiAgent 用） */
export function getProfilePrompt(): string {
  return profileToPrompt(loadUserProfile());
}
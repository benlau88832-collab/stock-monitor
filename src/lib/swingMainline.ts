// ============================================================
// v9.138.0（波段重构·阶段一）：波段主线引擎 —— 趋势+资金+催化三维
// 定位：波段游资的"选方向"层。替代"涨停热度"单维排序：
//   ① 趋势分（40%）：行业指数 20 日趋势（站上 MA20 / 20 日涨幅 / 趋势斜率）
//   ② 资金分（35%）：行业主力资金 10/20 日方向（fund_streak 历史序列聚合）
//   ③ 催化分（25%）：近 N 日新闻/政策催化强度（事件分级 + 政策语料 + 快讯热度）
// 输出：波段方向榜（排序 + 各维分数 + 信号明细），供波段作战室第一屏
// 数据输入：行业板块日K（90.BKxxxx，东财 push2his）+ fund_streak:日期 kv 序列 + 快讯
// 纯函数核心（scoreBoard）可单测；数据装配（buildSwingMainlines）由 UI/服务端调用
// ============================================================
import { classifySwingPhase, type KlineBar } from "./swingStage";

export interface SwingBoardInput {
  code: string;              // BKxxxx
  name: string;              // 行业名
  klines: KlineBar[];        // 板块指数日K（升序）
  /** 近 N 日主力资金净额序列（元，升序=旧→新；可缺省） */
  fundSeq?: number[];
  /** 近 N 日催化事件（标题/等级） */
  catalysts?: Array<{ title: string; level?: string; ts?: number }>;
}

export interface SwingBoardScore {
  code: string;
  name: string;
  trend: number;      // 0-100
  fund: number;       // 0-100
  catalyst: number;   // 0-100
  total: number;      // 加权总分
  phase: string;      // 板块波段阶段（复用 swingStage）
  ma20Up: boolean;
  pct20d: number | null;
  fund10d: number | null;   // 近10日净流入（亿）
  fund20d: number | null;   // 近20日净流入（亿）
  catalystsTop: string[];
  signals: string[];
}

// ---------- 趋势分 ----------
export function scoreTrend(klines: KlineBar[]): { score: number; ma20Up: boolean; pct20d: number | null; phase: string; signals: string[] } {
  const signals: string[] = [];
  if (!klines || klines.length < 21) return { score: 0, ma20Up: false, pct20d: null, phase: "数据不足", signals: ["板块K线不足 21 根"] };
  const closes = klines.map(k => k.close);
  const last = closes[closes.length - 1];
  const p20 = closes[closes.length - 21];
  const pct20d = p20 > 0 ? (last - p20) / p20 * 100 : null;
  // MA20 与均线斜率（近 5 日 MA20 变化）
  const ma20 = closes.slice(-20).reduce((s, v) => s + v, 0) / 20;
  const ma20Prev = closes.slice(-21, -1).reduce((s, v) => s + v, 0) / 20;
  const ma20Up = ma20 > ma20Prev;
  const aboveMa20 = last > ma20;

  let score = 50;
  if (aboveMa20) score += 20; else score -= 20;
  if (ma20Up) score += 10; else score -= 10;
  if (pct20d != null) {
    if (pct20d > 8) score += 15;
    else if (pct20d > 3) score += 8;
    else if (pct20d < -5) score -= 15;
    else if (pct20d < -2) score -= 8;
  }
  // 阶段信息（复用个股位置模型：板块指数同样有平台/主升/退潮）
  const stage = classifySwingPhase(klines);
  if (stage.phase === "主升") score += 5;
  if (stage.phase === "退潮") score -= 10;
  signals.push(stage.phase === "数据不足" ? stage.signals[0] ?? "" : `板块阶段：${stage.phase}`);
  if (aboveMa20) signals.push("指数站上 MA20");
  if (pct20d != null) signals.push(`20日涨幅 ${pct20d > 0 ? "+" : ""}${pct20d.toFixed(1)}%`);
  return { score: Math.max(0, Math.min(100, score)), ma20Up: aboveMa20, pct20d, phase: stage.phase, signals };
}

// ---------- 资金分（10/20 日方向） ----------
export function scoreFund(fundSeq?: number[]): { score: number; fund10d: number | null; fund20d: number | null; signals: string[] } {
  const signals: string[] = [];
  if (!fundSeq || fundSeq.length === 0) return { score: 50, fund10d: null, fund20d: null, signals: ["资金序列缺失（中性）"] };
  const seq = fundSeq;
  const last10 = seq.slice(-10);
  const last20 = seq.slice(-20);
  const sum10 = last10.reduce((s, v) => s + v, 0);
  const sum20 = last20.reduce((s, v) => s + v, 0);
  const fund10d = Math.round(sum10 / 1e8 * 10) / 10; // 亿
  const fund20d = Math.round(sum20 / 1e8 * 10) / 10;
  let score = 50;
  if (sum10 > 0) score += 20; else score -= 15;
  if (sum20 > 0) score += 10; else score -= 10;
  if (sum10 > 0 && sum20 > 0) score += 5;   // 持续流入
  if (sum10 < 0 && sum20 > 0) score -= 5;   // 近10日转流出
  signals.push(`近10日主力 ${fund10d > 0 ? "+" : ""}${fund10d}亿`);
  signals.push(`近20日主力 ${fund20d > 0 ? "+" : ""}${fund20d}亿`);
  return { score: Math.max(0, Math.min(100, score)), fund10d, fund20d, signals };
}

// ---------- 催化分（新闻/政策/事件强度） ----------
export function scoreCatalyst(catalysts?: Array<{ title: string; level?: string; ts?: number }>): { score: number; catalystsTop: string[]; signals: string[] } {
  const signals: string[] = [];
  if (!catalysts || catalysts.length === 0) return { score: 50, catalystsTop: [], signals: ["近 N 日无催化事件"] };
  const LEVEL_W = { 政策: 25, 行业: 15, 事件: 8, critical: 20, warning: 10, info: 5 };
  let s = 50;
  const tops: string[] = [];
  for (const c of catalysts.slice(0, 10)) {
    const w = LEVEL_W[(c.level ?? "事件") as keyof typeof LEVEL_W] ?? 8;
    s += w;
    if (tops.length < 3) tops.push(String(c.title ?? "").slice(0, 24));
  }
  signals.push(`${catalysts.length} 条催化事件（近 N 日）`);
  return { score: Math.max(0, Math.min(100, s)), catalystsTop: tops, signals };
}

// ---------- 综合评分（纯函数，可单测） ----------
export function scoreBoard(b: SwingBoardInput): SwingBoardScore {
  const t = scoreTrend(b.klines);
  const f = scoreFund(b.fundSeq);
  const c = scoreCatalyst(b.catalysts);
  const total = Math.round(t.score * 0.40 + f.score * 0.35 + c.score * 0.25);
  return {
    code: b.code,
    name: b.name,
    trend: t.score,
    fund: f.score,
    catalyst: c.score,
    total,
    phase: t.phase,
    ma20Up: t.ma20Up,
    pct20d: t.pct20d,
    fund10d: f.fund10d,
    fund20d: f.fund20d,
    catalystsTop: c.catalystsTop,
    signals: [...t.signals, ...f.signals, ...c.signals],
  };
}

/** 排序（总分降序，主升/启动优先） */
export function rankSwingBoards(boards: SwingBoardScore[]): SwingBoardScore[] {
  const PHASE_W: Record<string, number> = { 主升: 3, 启动: 2, 底部整理: 1, 加速: 1, 退潮: 0, 数据不足: 0 };
  return [...boards].sort((a, b) => {
    const pa = PHASE_W[a.phase] ?? 0, pb = PHASE_W[b.phase] ?? 0;
    if (pb !== pa) return pb - pa;
    return b.total - a.total;
  });
}

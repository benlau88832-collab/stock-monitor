// ============================================================
// v9.45（V5-3）：决策器命中率对账 —— "凭什么信 AI"的终极证据
// 把 decision_log（AI/规则裁决）与次日情绪延续对账，得到：
//   "AI 说可上车 → 次日情绪是否延续" 的胜率，与规则投票同口径对比。
// 标签口径与 factorLib.markNextWin 一致（次日情绪分 ≥ 当日 → win）。
// 数据：decision_log:日期（localStorage，cloudStore 同步 PG）+ sentiment:日期（PG）。
// 局限：第一版用宏观情绪延续代理"主线实际涨跌"，主线级对账留待 zt_snapshot 全量接口。
// ============================================================
import { kvGet } from "./cloudStore";
import { getBJDate, getBJWeekday } from "./format";

export interface HitrateBucket {
  hits: number;
  total: number;
  rate: number | null; // 0-100
}

export interface HitrateResult {
  ai: HitrateBucket;   // source=AI-Agent（真 AI 裁决）
  rule: HitrateBucket; // source=规则投票（含降级）
  // v9.75（阶段三）：降级样本独立分桶 —— LLM 失败/配额受限的裁决既不算 AI 也不算规则，
  // 此前全部落入 rule 桶 → 规则胜率被 AI 故障污染、AI 胜率幸存者偏差
  degraded: HitrateBucket;
}

export interface DecisionLogEntry {
  date: string;
  ts: string;
  mainline: string;
  action: string;
  source: string;
  confidence: number;
  gatedDowngrade?: string | null;
  agentReason?: string;
  path?: string;
  rateLimited?: boolean;
}

/** 读近 N 天 localStorage decision_log:日期（倒序返回） */
export function loadDecisionLogs(days = 30): DecisionLogEntry[] {
  const out: DecisionLogEntry[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    try {
      const arr = JSON.parse(localStorage.getItem(`decision_log:${ds}`) ?? "[]");
      for (const l of arr) out.push({ ...(l as Omit<DecisionLogEntry, "date">), date: ds });
    } catch { /* 单日损坏跳过 */ }
  }
  return out;
}

/** 下一交易日（简单跳过周六日；节假日无 sentiment 自然被过滤） */
export function nextTradingDay(ds: string): string | null {
  const d = new Date(ds + "T00:00:00+08:00");
  if (Number.isNaN(d.getTime())) return null;
  for (let i = 1; i <= 7; i++) {
    const t = new Date(d);
    t.setDate(t.getDate() + i);
    // v9.60（V9-D3）：周末判定用北京时间（getBJDate），替代本机 getDay() 时区偏移
    // v9.63-fix（补丁）：显式 getBJWeekday
    const bj = getBJDate(t);
    if (getBJWeekday(bj) !== 0 && getBJWeekday(bj) !== 6) {
      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    }
  }
  return null;
}

/**
 * 计算"可上车"裁决的次日情绪延续命中率（AI vs 规则）。
 * 仅统计有次日 sentiment 的样本（本地部署；GitHub Pages 无 PG → 全样本不足）。
 */
export async function computeDecisionHitrate(days = 30): Promise<HitrateResult> {
  const logs = loadDecisionLogs(days).filter(l => l.action === "可上车");
  const res: HitrateResult = {
    ai: { hits: 0, total: 0, rate: null },
    rule: { hits: 0, total: 0, rate: null },
    degraded: { hits: 0, total: 0, rate: null },
  };
  const cache = new Map<string, number | null>();
  const getSenti = async (ds: string): Promise<number | null> => {
    if (cache.has(ds)) return cache.get(ds)!;
    let v: number | null = null;
    try {
      const n = Number(await kvGet(`sentiment:${ds}`) ?? NaN);
      if (Number.isFinite(n)) v = n;
    } catch { /* 静默 */ }
    cache.set(ds, v);
    return v;
  };

  for (const l of logs) {
    const next = nextTradingDay(l.date);
    if (!next) continue;
    const cur = await getSenti(l.date);
    const nxt = await getSenti(next);
    if (cur == null || nxt == null) continue;
    const win = nxt >= cur ? 1 : 0;
    // v9.75（阶段三）：降级样本分桶 —— path=rule_fallback（LLM 不可用/轮次耗尽）或 rateLimited（配额受限）
    // 不算 AI 也不污染 rule（AI 故障与规则水平是两回事）
    const isDegraded = l.path === "rule_fallback" || l.rateLimited === true || l.gatedDowngrade != null;
    const bucket = isDegraded ? res.degraded : (l.source === "AI-Agent" ? res.ai : res.rule);
    bucket.total++;
    bucket.hits += win;
  }
  if (res.ai.total > 0) res.ai.rate = Math.round(res.ai.hits / res.ai.total * 100);
  if (res.rule.total > 0) res.rule.rate = Math.round(res.rule.hits / res.rule.total * 100);
  if (res.degraded.total > 0) res.degraded.rate = Math.round(res.degraded.hits / res.degraded.total * 100);
  return res;
}

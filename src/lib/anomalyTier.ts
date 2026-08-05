// 异动捕捉引擎（v9.24-P1-4，PRD 5.6 / A5）
// S/A/B 三级异动分级 + 统一异动事件流
// S级(紧急): 涨停封单/开板、20cm快速拉升、重大利好 → 红色闪烁+声音
// A级(重要): 量比>5、换手>15%、快速拉升>7% → 列表置顶+高亮
// B级(关注): 温和放量、题材小幅异动 → 常规列表
// 前端事件流（内存+localStorage 会话级），未来可无缝接真实 tick 数据源
// v9.27（P0-4）：接入诱多探测引擎 detectTrap —— S 级命中诱多 → 强制"禁止追高·疑似诱多"
import { detectTrap } from "./trapDetector";

export type AnomalyLevel = "S" | "A" | "B";

export interface AnomalyEvent {
  id: string;
  level: AnomalyLevel;
  code: string;
  name: string;
  /** 触发时间（epoch ms） */
  ts: number;
  /** 首次触发时间（同 code+level 冷却期内保持首次） */
  firstSeen: number;
  /** 触发原因（≤30字） */
  reason: string;
  /** 是否呼应今日主线 */
  mainlineHit: boolean;
  mainlineName: string | null;
  /** AI 一句话研判（规则引擎生成） */
  aiComment: string;
  /** v9.26 A.6：LLM 异步解释（事件驱动，S/A 级触发后补写；空=未生成） */
  aiCommentLLM?: string;
  /** v9.26 A.6：LLM 解释是否降级 */
  aiLLMDegraded?: boolean;
  /** 建议动作：观察/可小仓试错/无需操作 */
  action: string;
  pct: number;
  volumeRatio: number | null;
  turnoverRate: number;
}

const MAX_EVENTS = 50;
/** 同 code+level 冷却：15 分钟内不重复 emit（避免刷屏） */
const COOLDOWN_MS = 15 * 60 * 1000;

let events: AnomalyEvent[] = [];
const listeners = new Set<() => void>();

function notify() { listeners.forEach(fn => fn()); }

export function subscribeAnomaly(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getAnomalies(): AnomalyEvent[] { return events; }

/** v9.26 A.6：更新某事件（LLM 解释补写），触发订阅刷新 */
export function updateAnomaly(id: string, patch: Partial<AnomalyEvent>): void {
  events = events.map(e => (e.id === id ? { ...e, ...patch } : e));
  notify();
}

// ============== 分级判定（PRD 5.6 规则引擎，纯实时数据） ==============
export interface AnomalyInput {
  code: string;
  name: string;
  pct: number;
  volumeRatio?: number | null;
  turnoverRate: number;
  /** v9.26.10：涨跌幅限制（10/20），区分主板/创业板/科创板（原 9.5 阈值对 20cm 股误判） */
  limitPct?: number;
  /** v9.27（P0-4）：诱多特征（可选，命中则并入判定） */
  sealFund?: number;      // 封单金额(元)
  amount?: number;        // 成交额(元)
  blastCount?: number;    // 当日炸板次数 zbc
  mainNetPct?: number;    // 主力净占比 %
  retailNetPct?: number;  // 散户净占比 %
}

export interface AnomalyVerdict {
  level: AnomalyLevel;
  reason: string;
  aiComment: string;
  action: string;
  mainlineHit: boolean;
  mainlineName: string | null;
}

/** 是否呼应主线：个股名与主线名做子词匹配 */
function hitMainline(name: string, mainlines: string[]): { hit: boolean; name: string | null } {
  for (const m of mainlines) {
    const subs = m.split(/[/·、,，\s]+/).filter(s => s.length >= 2);
    for (const sub of subs) {
      if (name.includes(sub) || sub.includes(name)) return { hit: true, name: m };
    }
  }
  return { hit: false, name: null };
}

export function classifyAnomaly(s: AnomalyInput, mainlines: string[] = []): AnomalyVerdict | null {
  const { pct, volumeRatio, turnoverRate } = s;
  const vr = volumeRatio ?? 0;
  const { hit, name } = hitMainline(s.name, mainlines);
  // v9.26.10：按涨跌幅限制判定"近涨停"（20cm 股涨 10% 不算接近涨停）
  const limitPct = s.limitPct ?? 10;
  const nearLimit = limitPct - 0.5;

  // S 级：近涨停 / 20cm 快速拉升 / 天量
  // v9.26.11：仓位建议五档 —— 重仓参与（主线核心）> 轻仓参与 > 观察·暂不参与 > 禁止追高 > 无需操作
  // v9.27（P0-4）：命中诱多特征 → 强制"禁止追高·疑似诱多"并红色标注
  const trapHit = detectTrap({
    code: s.code, name: s.name, pct,
    sealFund: s.sealFund, amount: s.amount, blastCount: s.blastCount,
    mainNetPct: s.mainNetPct, retailNetPct: s.retailNetPct,
    isMainline: hit,
  });

  if (pct >= nearLimit) {
    if (trapHit.isTrap) {
      return {
        level: "S",
        reason: `涨幅${pct.toFixed(1)}% 接近涨停（${trapHit.type}）`,
        aiComment: `⚠ ${trapHit.reason}`,
        action: "禁止追高·疑似诱多",
        mainlineHit: hit, mainlineName: name,
      };
    }
    return {
      level: "S",
      reason: `涨幅${pct.toFixed(1)}% 接近涨停`,
      aiComment: hit ? "呼应当前主线，强势封板形态" : "孤立异动，谨慎追高",
      // 主线 + 强势封板 → 重仓参与；主线 → 轻仓参与；非主线 → 禁止追高
      action: hit ? (pct >= limitPct ? "重仓参与（主线核心）" : "轻仓参与（跟主线）") : "禁止追高",
      mainlineHit: hit, mainlineName: name,
    };
  }
  if (pct >= 7 && vr >= 3) {
    if (trapHit.isTrap) {
      return {
        level: "S",
        reason: `${pct.toFixed(1)}% 快速拉升 + 量比${vr.toFixed(1)}（${trapHit.type}）`,
        aiComment: `⚠ ${trapHit.reason}`,
        action: "禁止追高·疑似诱多",
        mainlineHit: hit, mainlineName: name,
      };
    }
    return {
      level: "S",
      reason: `${pct.toFixed(1)}% 快速拉升 + 量比${vr.toFixed(1)}`,
      aiComment: hit ? "主线内放量拉升，资金加速" : "放量急拉但不在主线，防诱多",
      action: hit ? "轻仓参与（跟主线）" : "禁止追高",
      mainlineHit: hit, mainlineName: name,
    };
  }

  // A 级：量比>5 / 换手>15% / 拉升>7%
  // v9.26.11：主线内可轻仓参与；非主线仅观察
  if (vr >= 5) {
    return {
      level: "A",
      reason: `量比${vr.toFixed(1)} 异常放量`,
      aiComment: hit ? "主线内异动放量，关注承接" : "异常放量，警惕出货",
      action: hit ? "轻仓参与（观察承接）" : "观察 · 暂不参与",
      mainlineHit: hit, mainlineName: name,
    };
  }
  if (turnoverRate >= 15) {
    return {
      level: "A",
      reason: `换手${turnoverRate.toFixed(0)}% 高换手`,
      aiComment: hit ? "主线内高换手，筹码活跃" : "高换手分歧，追高谨慎",
      action: hit ? "轻仓参与（筹码活跃）" : "观察 · 暂不参与",
      mainlineHit: hit, mainlineName: name,
    };
  }
  if (pct >= 7) {
    return {
      level: "A",
      reason: `涨幅${pct.toFixed(1)}%`,
      aiComment: hit ? "主线内走强" : "偏离主线强势，防脉冲",
      action: hit ? "轻仓参与（主线走强）" : "观察 · 暂不参与",
      mainlineHit: hit, mainlineName: name,
    };
  }

  // B 级：温和放量 / 换手抬升
  if (pct >= 3 || vr >= 1.5 || turnoverRate >= 8) {
    return {
      level: "B",
      reason: `涨${pct.toFixed(1)}% 量比${vr.toFixed(1)} 换手${turnoverRate.toFixed(0)}%`,
      aiComment: hit ? "主线内温和异动" : "小幅异动，暂不构成信号",
      action: "无需操作",
      mainlineHit: hit, mainlineName: name,
    };
  }

  return null;
}

// ============== 事件流 ==============
export function emitAnomaly(verdict: AnomalyVerdict, s: AnomalyInput): AnomalyEvent | null {
  const now = Date.now();
  // 冷却去重：同 code+level 15 分钟内不重复
  const recent = events.find(e => e.code === s.code && e.level === verdict.level && now - e.firstSeen < COOLDOWN_MS);
  if (recent) return null;
  const evt: AnomalyEvent = {
    id: `${s.code}-${verdict.level}-${now}`,
    level: verdict.level,
    code: s.code,
    name: s.name,
    ts: now,
    firstSeen: now,
    reason: verdict.reason,
    mainlineHit: verdict.mainlineHit,
    mainlineName: verdict.mainlineName,
    aiComment: verdict.aiComment,
    action: verdict.action,
    pct: s.pct,
    volumeRatio: s.volumeRatio ?? null,
    turnoverRate: s.turnoverRate,
  };
  events = [evt, ...events].slice(0, MAX_EVENTS);
  notify();
  return evt;
}

/** 清空（会话级） */
export function clearAnomalies() { events = []; notify(); }

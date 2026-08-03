// 异动捕捉引擎（v9.24-P1-4，PRD 5.6 / A5）
// S/A/B 三级异动分级 + 统一异动事件流
// S级(紧急): 涨停封单/开板、20cm快速拉升、重大利好 → 红色闪烁+声音
// A级(重要): 量比>5、换手>15%、快速拉升>7% → 列表置顶+高亮
// B级(关注): 温和放量、题材小幅异动 → 常规列表
// 前端事件流（内存+localStorage 会话级），未来可无缝接真实 tick 数据源

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

// ============== 分级判定（PRD 5.6 规则引擎，纯实时数据） ==============
export interface AnomalyInput {
  code: string;
  name: string;
  pct: number;
  volumeRatio?: number | null;
  turnoverRate: number;
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

  // S 级：近涨停 / 20cm 快速拉升 / 天量
  if (pct >= 9.5) {
    return {
      level: "S",
      reason: `涨幅${pct.toFixed(1)}% 接近涨停`,
      aiComment: hit ? "呼应当前主线，强势封板形态" : "孤立异动，谨慎追高",
      action: hit ? "可小仓试错" : "观察为主",
      mainlineHit: hit, mainlineName: name,
    };
  }
  if (pct >= 7 && vr >= 3) {
    return {
      level: "S",
      reason: `${pct.toFixed(1)}% 快速拉升 + 量比${vr.toFixed(1)}`,
      aiComment: hit ? "主线内放量拉升，资金加速" : "放量急拉但不在主线，防诱多",
      action: hit ? "可小仓试错" : "观察为主",
      mainlineHit: hit, mainlineName: name,
    };
  }

  // A 级：量比>5 / 换手>15% / 拉升>7%
  if (vr >= 5) {
    return {
      level: "A",
      reason: `量比${vr.toFixed(1)} 异常放量`,
      aiComment: hit ? "主线内异动放量，关注承接" : "异常放量，警惕出货",
      action: "观察",
      mainlineHit: hit, mainlineName: name,
    };
  }
  if (turnoverRate >= 15) {
    return {
      level: "A",
      reason: `换手${turnoverRate.toFixed(0)}% 高换手`,
      aiComment: hit ? "主线内高换手，筹码活跃" : "高换手分歧，追高谨慎",
      action: "观察",
      mainlineHit: hit, mainlineName: name,
    };
  }
  if (pct >= 7) {
    return {
      level: "A",
      reason: `涨幅${pct.toFixed(1)}%`,
      aiComment: hit ? "主线内走强" : "偏离主线强势，防脉冲",
      action: "观察",
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

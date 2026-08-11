// ============================================================
// src/lib/llmJson.ts —— LLM 输出 JSON 统一解析 + schema 注册表（P1-8）
// 背景：此前解析容错（剥围栏/正则提取/截断补 ]）只在 parseAIJSON 一处，
//   字段校验（数值 clamp/枚举过滤/必填）却散落在 14 个调用点 inline，前后端各写各的。
// 本模块收敛为：
//   parseLLMJSON(text, schema) —— 统一容错解析 + 按 schema 归一化（类型/枚举/范围/必填）
//   LLM_JSON_TASKS —— task → schema 注册表（单一事实来源，服务端 server/lib/llmJson.js 同构）
// 语义约定：
//   - number：Number() 化，非有限数 → default ?? 0，再 clamp [min,max]
//   - enum：不在枚举 → default ?? 保留原值
//   - string：String() 化 + maxLen 截断
//   - required 字段缺失（数组元素）：剔除该元素；过滤后空数组 → null（与 parseAIJSON 语义一致）
//   - 反幻觉白名单（board/code 输入集校验）属业务层，不在 schema 内 —— 调用点归一化后自做
// ============================================================

export interface FieldSpec {
  type: "string" | "number" | "boolean" | "array" | "object";
  /** 枚举白名单；不匹配时用 default（未设则保留原值） */
  enum?: readonly string[];
  /** number 范围（clamp） */
  min?: number;
  max?: number;
  /** string 最大长度（截断） */
  maxLen?: number;
  /** 缺失/非法时的兜底值（默认：number→0，string→""，其他保留） */
  default?: unknown;
  /** 数组元素规格（type=array 时） */
  item?: FieldSpec;
}

export interface TaskSchema {
  /** 顶层结构：array=元素列表 / object=单个对象 */
  kind: "array" | "object";
  /** 元素（array）或对象（object）的字段规格 */
  fields?: Record<string, FieldSpec>;
  /** 必填字段：缺失的元素剔除 / 对象字段缺失忽略 */
  requiredFields?: readonly string[];
  /** 数组任务最多保留前 N 条（防 LLM 输出超长列表） */
  maxItems?: number;
}

// ============== 解析容错（剥围栏 → 正则提取 → 截断补 ] → 尾随逗号修复） ==============

// v9.100.0（P1-06）：tryParse 加尾随逗号修复 —— DeepSeek 长 JSON 输出（主线归类大数组等）常见
//   `{"a":1,}` / `[1,2,]` 尾随逗号，裸 JSON.parse 拒收 → 前端降级规则版（审查实测 mainlineClassify/
//   criticReview/annRank 全部"上游响应非法 JSON"）。修复后 JSON.parse 重试一次（与 server/lib/llmJson.js 同构）
function tryParse(text: string): unknown {
  try { return JSON.parse(text); } catch {
    const fixed = String(text).replace(/,\s*([}\]])/g, "$1");
    if (fixed !== text) { try { return JSON.parse(fixed); } catch { /* 继续 */ } }
    return null;
  }
}

/** 从 LLM 原始输出中提取最可能的 JSON 文本（剥围栏 + 取第一个 [ ] 或 { }） */
function extractJSONText(raw: string): string | null {
  if (!raw) return null;
  let cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  // v9.87.0：输入以 [ 开头 = 数组输出场景（可能被 max_tokens 截断无闭合 ]）——
  // 直接交给 parseWithTruncation（内部对象会先被 { } 正则命中导致误提取）
  if (cleaned.startsWith("[")) return cleaned;
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (arrMatch && objMatch) {
    return (arrMatch.index ?? Infinity) < (objMatch.index ?? Infinity) ? arrMatch[0] : objMatch[0];
  }
  if (arrMatch) return arrMatch[0];
  if (objMatch) return objMatch[0];
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace >= 0) return cleaned.slice(firstBrace);
  return null;
}

/** 完整 parse；数组被 max_tokens 截断时从最后一个 } 截断补 ] 重试 */
function parseWithTruncation(target: string): unknown {
  const direct = tryParse(target);
  if (direct !== null) return direct;
  if (target.startsWith("[")) {
    for (let idx = target.lastIndexOf("}"); idx > 0; idx = target.lastIndexOf("}", idx - 1)) {
      const p = tryParse(target.slice(0, idx + 1) + "]");
      if (p !== null) return p;
    }
  }
  return null;
}

// ============== schema 归一化 ==============

function normalizeNumber(v: unknown, spec: FieldSpec): number {
  const n = Number(v);
  const fallback = typeof spec.default === "number" ? spec.default : 0;
  let out = Number.isFinite(n) ? n : fallback;
  if (typeof spec.min === "number" && out < spec.min) out = spec.min;
  if (typeof spec.max === "number" && out > spec.max) out = spec.max;
  return out;
}

function normalizeString(v: unknown, spec: FieldSpec): string {
  let s = String(v ?? "");
  // 枚举归一化：不在枚举 → 用 default（设置了才替换，未设置保留原值防误杀）
  if (spec.enum && !spec.enum.includes(s)) {
    if (spec.default !== undefined) return String(spec.default);
  }
  if (spec.maxLen && s.length > spec.maxLen) s = s.slice(0, spec.maxLen);
  return s;
}

function normalizeBoolean(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

function normalizeValue(v: unknown, spec: FieldSpec): unknown {
  switch (spec.type) {
    case "number": return normalizeNumber(v, spec);
    case "string": return normalizeString(v, spec);
    case "boolean": return normalizeBoolean(v);
    case "array": {
      if (!Array.isArray(v)) return spec.default ?? [];
      return v.map(x => (spec.item ? normalizeValue(x, spec.item) : x));
    }
    case "object": {
      if (!v || typeof v !== "object" || Array.isArray(v)) return spec.default ?? {};
      return v;
    }
    default: return v;
  }
}

/** 按 schema 归一化对象字段；返回 null 表示必填缺失（数组元素剔除） */
function normalizeObject(item: unknown, schema: TaskSchema): Record<string, unknown> | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const src = item as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const fields = schema.fields ?? {};
  for (const [name, spec] of Object.entries(fields)) {
    if (name in src && src[name] !== undefined && src[name] !== null) {
      out[name] = normalizeValue(src[name], spec);
    } else if (spec.default !== undefined) {
      out[name] = spec.default;
    }
  }
  // 未在 schema 中的字段原样保留（防止误删调用方需要的字段）
  for (const k of Object.keys(src)) {
    if (!(k in out)) out[k] = src[k];
  }
  if (schema.requiredFields) {
    for (const f of schema.requiredFields) {
      if (!(f in out) || out[f] === undefined) return null;
    }
  }
  return out;
}

// ============== 主入口 ==============

/**
 * 统一 LLM JSON 解析：容错提取 → parse（含截断补全）→ schema 归一化。
 * @param raw LLM 原始输出（可含围栏/说明文字）
 * @param schema 任务 schema（无则仅容错解析，行为≈原 parseAIJSON）
 * @returns 归一化后的数据；解析失败/必填全缺 → null
 */
export function parseLLMJSON<T = unknown>(raw: string, schema?: TaskSchema): T | null {
  if (!raw) return null;
  const target = extractJSONText(raw);
  if (!target) return null;
  const parsed = parseWithTruncation(target);
  if (parsed === null) return null;
  if (!schema) return parsed as T;
  if (schema.kind === "array") {
    if (!Array.isArray(parsed)) return null;
    const out: unknown[] = [];
    for (const item of parsed) {
      const norm = normalizeObject(item, schema);
      if (norm !== null) out.push(norm);
    }
    if (out.length === 0) return null;
    return (schema.maxItems ? out.slice(0, schema.maxItems) : out) as T;
  }
  // object
  const norm = normalizeObject(parsed, schema);
  return norm as T;
}

// ============== task → schema 注册表（前端与服务端 server/lib/llmJson.js 同构） ==============

/** 事件三级分级（EventClassifyPanel / cron runEventClassify） */
const EVENT_CLASSIFY: TaskSchema = {
  kind: "array",
  requiredFields: ["title"],
  maxItems: 20,
  fields: {
    title: { type: "string", maxLen: 80 },
    level: { type: "string", enum: ["政策", "行业", "事件"] },
    beneficiaries: { type: "array", item: { type: "string", maxLen: 20 } },
    catalystScore: { type: "number", min: 0, max: 100 },
    timeSensitivity: { type: "string", enum: ["即时", "短期", "中长期"] },
    reason: { type: "string", maxLen: 60 },
  },
};

/** 主线排名（mainlineLLM mainlineRank） */
const MAINLINE_RANK: TaskSchema = {
  kind: "array",
  requiredFields: ["board", "rank"],
  maxItems: 8,
  fields: {
    board: { type: "string", maxLen: 30 },
    rank: { type: "number", min: 1, max: 8 },
    isPulse: { type: "boolean" },
    confidence: { type: "number", min: 0, max: 100 },
    leaders: {
      type: "array",
      item: {
        type: "object",
      },
    },
    logic: { type: "string", maxLen: 80 },
  },
};

/** 当日市场情报（llmNewsIntelligence dailyIntel） */
const DAILY_INTEL: TaskSchema = {
  kind: "object",
  fields: {
    cycleStage: {
      type: "string",
      enum: ["启动", "主升", "分歧", "退潮", "冰点", "修复"],
    },
    focusThemes: { type: "array", item: { type: "string", maxLen: 30 } },
    whatMarketTrades: { type: "string", maxLen: 200 },
    trend: { type: "string", maxLen: 60 },
    positiveIndustries: { type: "array", item: { type: "string", maxLen: 30 } },
    negativeIndustries: { type: "array", item: { type: "string", maxLen: 30 } },
    topEvents: {
      type: "array",
      item: {
        type: "object",
      },
    },
    directionAdvice: { type: "string", maxLen: 200 },
    rawSummary: { type: "string", maxLen: 500 },
  },
};

/** 个股消息评分（llmSignals stockNewsScore） */
const STOCK_NEWS_SCORE: TaskSchema = {
  kind: "array",
  requiredFields: ["code", "msgScore"],
  maxItems: 30,
  fields: {
    code: { type: "string", maxLen: 10 },
    msgScore: { type: "number", min: 0, max: 100 },
    polarity: { type: "string", enum: ["positive", "negative", "neutral"] },
    invalidation: { type: "string", maxLen: 80 },
  },
};

/** 板块消息评分（llmSignals themeNewsScore） */
const THEME_NEWS_SCORE: TaskSchema = {
  kind: "array",
  requiredFields: ["board", "catalyst"],
  maxItems: 30,
  fields: {
    board: { type: "string", maxLen: 30 },
    catalyst: { type: "number", min: 0, max: 100 },
    polarity: { type: "string", enum: ["positive", "negative", "neutral"] },
    novelty: { type: "number", min: 0, max: 100 },
    reason: { type: "string", maxLen: 60 },
  },
};

/** 公告催化评分（AnnouncementPanel annRank） */
const ANN_RANK: TaskSchema = {
  kind: "array",
  requiredFields: ["code", "score"],
  maxItems: 20,
  fields: {
    code: { type: "string", maxLen: 10 },
    theme: { type: "string", maxLen: 30 },
    score: { type: "number", min: 1, max: 5 },
    logic: { type: "string", maxLen: 80 },
    watch: { type: "boolean" },
  },
};

/** 龙头预测（App leaderPredict） */
const LEADER_PREDICT: TaskSchema = {
  kind: "object",
  fields: {
    predictLeader: { type: "object" },
    confidence: { type: "number", min: 0, max: 100 },
    reason: { type: "string", maxLen: 200 },
    watch: { type: "array", item: { type: "string", maxLen: 10 } },
  },
};

/** 风险雷达（App riskRadar） */
const RISK_RADAR: TaskSchema = {
  kind: "object",
  fields: {
    level: { type: "string", enum: ["低", "中", "高"] },
    points: {
      type: "array",
      item: {
        type: "object",
      },
    },
    advice: { type: "string", maxLen: 300 },
  },
};

/** 明日情景（App nextDayScenarios） */
const NEXT_DAY_SCENARIOS: TaskSchema = {
  kind: "array",
  maxItems: 5,
  fields: {
    scenario: { type: "string", maxLen: 100 },
    probability: { type: "number", min: 0, max: 100 },
    conditions: { type: "array", item: { type: "string", maxLen: 80 } },
    focus: { type: "array", item: { type: "string", maxLen: 30 } },
  },
};

/** 关卡预测（App nextGatePredict） */
const NEXT_GATE_PREDICT: TaskSchema = {
  kind: "object",
  fields: {
    nextGate: { type: "string", maxLen: 100 },
    reason: { type: "string", maxLen: 200 },
    watchPoints: { type: "array", item: { type: "string", maxLen: 80 } },
  },
};

/** 主线诊断（MainlineDiagnosisCard mainlineDiagnosis） */
const MAINLINE_DIAGNOSIS: TaskSchema = {
  kind: "object",
  requiredFields: ["strength_score", "mainline"],
  fields: {
    strength_score: { type: "number", min: 0, max: 100 },
    stage: { type: "string", maxLen: 20 },
    mainline: { type: "string", maxLen: 40 },
    leader: { type: "object" },
    action: { type: "string", maxLen: 100 },
    risk: { type: "string", maxLen: 200 },
    exit_signal_triggered: { type: "boolean" },
    confidence: { type: "number", min: 0, max: 100 },
  },
};

/** 个股主线归属（stockToMainline mainlineClassify） */
const MAINLINE_CLASSIFY: TaskSchema = {
  kind: "object",
  requiredFields: ["stocks"],
  fields: {
    stocks: {
      type: "array",
      item: {
        type: "object",
      },
    },
    groups: { type: "array", item: { type: "object" } },
    overview: { type: "string", maxLen: 300 },
  },
};

/** 批判复核（aiAgent criticReview） */
const CRITIC_REVIEW: TaskSchema = {
  kind: "object",
  fields: {
    canRefute: { type: "boolean" },
    why: { type: "string", maxLen: 200 },
    suggestAction: { type: "string", maxLen: 100 },
  },
};

/** 事件深挖（agentTools eventDeepDive） */
const EVENT_DEEP_DIVE: TaskSchema = {
  kind: "object",
  fields: {
    chain: { type: "string", maxLen: 200 },
    targets: {
      type: "array",
      item: {
        type: "object",
      },
    },
    risk: { type: "string", maxLen: 200 },
    confirm: { type: "string", maxLen: 100 },
    conclusion: { type: "string", maxLen: 300 },
  },
};

/** 因子归因（agentTools factorAttribution） */
const FACTOR_ATTRIBUTION: TaskSchema = {
  kind: "object",
  fields: {
    summary: { type: "string", maxLen: 300 },
    suggestions: { type: "array", item: { type: "string", maxLen: 100 } },
  },
};

export const LLM_JSON_TASKS: Record<string, TaskSchema> = {
  eventClassify: EVENT_CLASSIFY,
  mainlineRank: MAINLINE_RANK,
  dailyIntel: DAILY_INTEL,
  stockNewsScore: STOCK_NEWS_SCORE,
  themeNewsScore: THEME_NEWS_SCORE,
  annRank: ANN_RANK,
  leaderPredict: LEADER_PREDICT,
  riskRadar: RISK_RADAR,
  nextDayScenarios: NEXT_DAY_SCENARIOS,
  nextGatePredict: NEXT_GATE_PREDICT,
  mainlineDiagnosis: MAINLINE_DIAGNOSIS,
  mainlineClassify: MAINLINE_CLASSIFY,
  criticReview: CRITIC_REVIEW,
  eventDeepDive: EVENT_DEEP_DIVE,
  factorAttribution: FACTOR_ATTRIBUTION,
};

/** 按 task 取 schema（无则 undefined —— 调用方可自行容错解析） */
export function schemaForTask(task: string): TaskSchema | undefined {
  return LLM_JSON_TASKS[task];
}

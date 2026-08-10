// ============================================================
// server/lib/llmJson.js —— 服务端 LLM JSON 统一解析（P1-8，与前端 src/lib/llmJson.ts 同构）
// 服务端 cron 的 7 个 LLM 调用点此前各自容错（裸 parse / parse+正则 / parseLoose），
// 3 处缺截断补全、全部缺枚举/数值校验。本模块收敛解析 + schema 归一化。
// 语义与前端一致：number clamp、enum 过滤（不匹配 → default ?? 保留原值）、
//   string maxLen 截断、requiredFields 缺失剔除元素、空数组 → null。
// ============================================================

function tryParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/** 剥围栏 + 取第一个 [ ] 或 { } */
function extractJSONText(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
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
function parseWithTruncation(target) {
  const direct = tryParse(target);
  if (direct !== null) return direct;
  if (String(target).startsWith("[")) {
    for (let idx = String(target).lastIndexOf("}"); idx > 0; idx = String(target).lastIndexOf("}", idx - 1)) {
      const p = tryParse(String(target).slice(0, idx + 1) + "]");
      if (p !== null) return p;
    }
  }
  return null;
}

function normalizeValue(v, spec) {
  switch (spec.type) {
    case "number": {
      const n = Number(v);
      const fallback = typeof spec.default === "number" ? spec.default : 0;
      let out = Number.isFinite(n) ? n : fallback;
      if (typeof spec.min === "number" && out < spec.min) out = spec.min;
      if (typeof spec.max === "number" && out > spec.max) out = spec.max;
      return out;
    }
    case "string": {
      let s = String(v ?? "");
      if (spec.maxLen && s.length > spec.maxLen) s = s.slice(0, spec.maxLen);
      return s;
    }
    case "boolean":
      return v === true || v === "true" || v === 1 || v === "1";
    case "array":
      if (!Array.isArray(v)) return spec.default ?? [];
      return v.map(x => (spec.item ? normalizeValue(x, spec.item) : x));
    default:
      return v;
  }
}

/** 按 schema 归一化对象；必填缺失 → null（数组元素剔除） */
function normalizeObject(item, schema) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const src = item;
  const out = {};
  const fields = schema.fields ?? {};
  for (const [name, spec] of Object.entries(fields)) {
    if (name in src && src[name] !== undefined && src[name] !== null) {
      out[name] = normalizeValue(src[name], spec);
    } else if (spec.default !== undefined) {
      out[name] = spec.default;
    }
  }
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

/**
 * 统一解析：容错提取 → parse（含截断补全）→ schema 归一化。
 * @param {string} raw LLM 原始输出
 * @param {object} schema 任务 schema（无则仅容错解析）
 * @returns 归一化数据；解析失败/必填全缺 → null
 */
function parseLLMJSON(raw, schema) {
  if (!raw) return null;
  const target = extractJSONText(raw);
  if (!target) return null;
  const parsed = parseWithTruncation(target);
  if (parsed === null) return null;
  if (!schema) return parsed;
  if (schema.kind === "array") {
    if (!Array.isArray(parsed)) return null;
    const out = [];
    for (const item of parsed) {
      const norm = normalizeObject(item, schema);
      if (norm !== null) out.push(norm);
    }
    if (out.length === 0) return null;
    return schema.maxItems ? out.slice(0, schema.maxItems) : out;
  }
  return normalizeObject(parsed, schema);
}

const SCHEMAS = {
  /** 黑天鹅二级确认（confirmBlackSwansWithLLM） */
  blackSwan: {
    kind: "array",
    requiredFields: ["title", "isBlackSwan"],
    fields: {
      title: { type: "string", maxLen: 120 },
      isBlackSwan: { type: "string", enum: ["yes", "no"] },
      level: { type: "string", enum: ["severe", "moderate"] },
      impact: { type: "string", maxLen: 20 },
    },
  },
  /** 快讯分级打分（rankFastNewsStars） */
  fastNewsRank: {
    kind: "array",
    requiredFields: ["title"],
    fields: {
      title: { type: "string", maxLen: 120 },
      stars: { type: "number", min: 1, max: 5 },
      sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
      logic: { type: "string", maxLen: 30 },
    },
  },
  /** 公告强催化评分（rankStrongAnnouncements） */
  annScore: {
    kind: "array",
    requiredFields: ["code"],
    fields: {
      code: { type: "string", maxLen: 10 },
      score: { type: "number", min: 1, max: 5 },
      logic: { type: "string", maxLen: 30 },
    },
  },
  /** 事件三级分级（runEventClassify，与前端 eventClassify 同构） */
  eventClassify: {
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
  },
  /** 主题联动判定（themeAnalysis Step3） */
  themeLinking: {
    kind: "array",
    requiredFields: ["theme"],
    fields: {
      theme: { type: "string", maxLen: 30 },
      verdict: { type: "string", enum: ["领涨龙头", "潜力起爆", "风险警示", "观察"] },
      fundAnalysis: { type: "string", maxLen: 80 },
      action: { type: "string", maxLen: 80 },
    },
  },
  /** 选股研判（themeAnalysis Step4） */
  stockSelect: {
    kind: "array",
    requiredFields: ["code"],
    fields: {
      code: { type: "string", maxLen: 10 },
      correlation: { type: "number", min: 0, max: 1 },
      verdict: { type: "string", enum: ["可买", "谨慎", "回避"] },
      buyTrigger: { type: "string", maxLen: 60 },
      stopLoss: { type: "string", maxLen: 60 },
      risk: { type: "string", maxLen: 60 },
    },
  },
  /** 用户风格画像（runUserStyleProfile） */
  userStyle: {
    kind: "object",
    fields: {
      style: { type: "string", maxLen: 20 },
      biases: { type: "array", item: { type: "string", maxLen: 30 } },
      avoidThemes: { type: "array", item: { type: "string", maxLen: 30 } },
      suggestion: { type: "string", maxLen: 200 },
    },
  },
};

// ============== 前端 task schema 注册表（与 src/lib/llmJson.ts 同构，供 /api/ai 校验） ==============

const EVENT_CLASSIFY = {
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
}

const MAINLINE_RANK = {
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
}

const DAILY_INTEL = {
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
}

const STOCK_NEWS_SCORE = {
  kind: "array",
  requiredFields: ["code", "msgScore"],
  maxItems: 30,
  fields: {
    code: { type: "string", maxLen: 10 },
    msgScore: { type: "number", min: 0, max: 100 },
    polarity: { type: "string", enum: ["positive", "negative", "neutral"] },
    invalidation: { type: "string", maxLen: 80 },
  },
}

const THEME_NEWS_SCORE = {
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
}

const ANN_RANK = {
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
}

const LEADER_PREDICT = {
  kind: "object",
  fields: {
    predictLeader: { type: "object" },
    confidence: { type: "number", min: 0, max: 100 },
    reason: { type: "string", maxLen: 200 },
    watch: { type: "array", item: { type: "string", maxLen: 10 } },
  },
}

const RISK_RADAR = {
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
}

const NEXT_DAY_SCENARIOS = {
  kind: "array",
  maxItems: 5,
  fields: {
    scenario: { type: "string", maxLen: 100 },
    probability: { type: "number", min: 0, max: 100 },
    conditions: { type: "array", item: { type: "string", maxLen: 80 } },
    focus: { type: "array", item: { type: "string", maxLen: 30 } },
  },
}

const NEXT_GATE_PREDICT = {
  kind: "object",
  fields: {
    nextGate: { type: "string", maxLen: 100 },
    reason: { type: "string", maxLen: 200 },
    watchPoints: { type: "array", item: { type: "string", maxLen: 80 } },
  },
}

const MAINLINE_DIAGNOSIS = {
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
}

const MAINLINE_CLASSIFY = {
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
}

const CRITIC_REVIEW = {
  kind: "object",
  fields: {
    canRefute: { type: "boolean" },
    why: { type: "string", maxLen: 200 },
    suggestAction: { type: "string", maxLen: 100 },
  },
}

const EVENT_DEEP_DIVE = {
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
}

const FACTOR_ATTRIBUTION = {
  kind: "object",
  fields: {
    summary: { type: "string", maxLen: 300 },
    suggestions: { type: "array", item: { type: "string", maxLen: 100 } },
  },
}

const FRONTEND_TASKS = {
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

// cron 侧任务 + 前端 task 合并（ai.js 校验用前端 task 名）
Object.assign(SCHEMAS, FRONTEND_TASKS);
module.exports = { parseLLMJSON, SCHEMAS };

// v9.87.0（P1-8）：前后端 LLM JSON schema 注册表一致性测试
// 守卫：前端 src/lib/llmJson.ts 与服务端 server/lib/llmJson.js 的同名 task schema
//   必须结构一致（kind/requiredFields/字段 type/enum/min/max）—— 防止一端改字段另一端漏改
import { describe, it, expect } from "vitest";
// @ts-ignore 服务端 CJS 无 .d.ts
import { SCHEMAS as serverSchemas } from "../../../server/lib/llmJson.js";
import { LLM_JSON_TASKS } from "../llmJson";

/** 规范化 schema 为可比较结构（去掉 TS 只读标记，字段排序稳定） */
function canon(schema: any): any {
  if (!schema) return schema;
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(schema.fields ?? {})) {
    const f = v as any;
    fields[k] = {
      type: f.type,
      ...(f.enum ? { enum: [...f.enum] } : {}),
      ...(f.min !== undefined ? { min: f.min } : {}),
      ...(f.max !== undefined ? { max: f.max } : {}),
      ...(f.maxLen !== undefined ? { maxLen: f.maxLen } : {}),
      ...(f.default !== undefined ? { default: f.default } : {}),
      ...(f.item ? { item: canon(f.item) } : {}),
    };
  }
  return {
    kind: schema.kind,
    fields,
    ...(schema.requiredFields ? { requiredFields: [...schema.requiredFields].sort() } : {}),
    ...(schema.maxItems !== undefined ? { maxItems: schema.maxItems } : {}),
  };
}

const SHARED_TASKS = [
  "eventClassify", "mainlineRank", "dailyIntel", "stockNewsScore", "themeNewsScore",
  "annRank", "leaderPredict", "riskRadar", "nextDayScenarios", "nextGatePredict",
  "mainlineDiagnosis", "mainlineClassify", "criticReview", "eventDeepDive", "factorAttribution",
];

describe("v9.87.0 前后端 schema 一致性", () => {
  it("服务端包含全部共享 task", () => {
    for (const t of SHARED_TASKS) {
      expect(serverSchemas[t], t).toBeDefined();
    }
  });

  it("共享 task 的 schema 结构完全一致", () => {
    for (const t of SHARED_TASKS) {
      expect(canon(serverSchemas[t]), t).toEqual(canon(LLM_JSON_TASKS[t]));
    }
  });

  it("cron 专用 schema 不受影响（blackSwan 等仍存在）", () => {
    expect(serverSchemas.blackSwan).toBeDefined();
    expect(serverSchemas.fastNewsRank).toBeDefined();
    expect(serverSchemas.annScore).toBeDefined();
    expect(serverSchemas.themeLinking).toBeDefined();
    expect(serverSchemas.stockSelect).toBeDefined();
    expect(serverSchemas.userStyle).toBeDefined();
  });
});

// v9.87.0（P1-8）：LLM JSON 统一解析 + schema 归一化测试
// 覆盖：围栏剥离 / 正则提取 / 截断补 ] / number clamp / enum 过滤 / required 剔除 / 空数组 → null
import { describe, it, expect } from "vitest";
import { parseLLMJSON, schemaForTask, LLM_JSON_TASKS } from "../llmJson";

const SIMPLE = {
  kind: "array",
  requiredFields: ["code"],
  fields: {
    code: { type: "string", maxLen: 10 },
    score: { type: "number", min: 1, max: 5 },
    level: { type: "string", enum: ["政策", "行业", "事件"] },
    sentiment: { type: "string", enum: ["positive", "negative", "neutral"], default: "neutral" },
  },
} as const;

describe("v9.87.0 parseLLMJSON 容错", () => {
  it("剥代码围栏", () => {
    const r = parseLLMJSON('```json\n[{"code":"600001","score":4}]\n```', SIMPLE);
    expect(r).toEqual([{ code: "600001", score: 4, sentiment: "neutral" }]);
  });

  it("文字包围 + 正则提取", () => {
    const r = parseLLMJSON('好的，分析如下：\n[{"code":"600001","score":4}]\n希望有帮助', SIMPLE);
    expect(r).toHaveLength(1);
  });

  it("max_tokens 截断 → 补 ] 恢复最后完整对象", () => {
    // 第二个对象未闭合无法恢复 → 只保留第一个完整对象（与 parseAIJSON v9.75 语义一致）
    const r = parseLLMJSON('[{"code":"600001","score":4},{"code":"600002","score":3', SIMPLE) as any[];
    expect(r).toHaveLength(1);
    expect(r[0].code).toBe("600001");
  });

  it("空输出 → null", () => {
    expect(parseLLMJSON("", SIMPLE)).toBeNull();
    expect(parseLLMJSON("纯文本无 JSON", SIMPLE)).toBeNull();
  });

  it("非数组对 array schema → null", () => {
    expect(parseLLMJSON('{"code":"x"}', SIMPLE)).toBeNull();
  });

  it("required 字段缺失元素被剔除；全缺 → null", () => {
    const r = parseLLMJSON('[{"score":5},{"code":"600001","score":3}]', SIMPLE);
    expect(r).toEqual([{ code: "600001", score: 3, sentiment: "neutral" }]);
    expect(parseLLMJSON('[{"score":5}]', SIMPLE)).toBeNull();
  });
});

describe("v9.87.0 parseLLMJSON schema 归一化", () => {
  it("number 越界 clamp（score 9 → 5，-3 → 1）", () => {
    const r = parseLLMJSON('[{"code":"a","score":9},{"code":"b","score":-3}]', SIMPLE) as any[];
    expect(r[0].score).toBe(5);
    expect(r[1].score).toBe(1);
  });

  it("number 非数字 → default 后 clamp 到 min", () => {
    const r = parseLLMJSON('[{"code":"a","score":"abc"}]', SIMPLE) as any[];
    expect(r[0].score).toBe(1); // NaN → 0 → clamp min 1
  });

  it("enum 不匹配 → default（设置了 default 时）", () => {
    const r = parseLLMJSON('[{"code":"a","sentiment":"weird"}]', SIMPLE) as any[];
    expect(r[0].sentiment).toBe("neutral");
  });

  it("enum 不匹配且无 default → 保留原值（不误杀）", () => {
    const r = parseLLMJSON('[{"code":"a","level":"超预期"}]', SIMPLE) as any[];
    expect(r[0].level).toBe("超预期");
  });

  it("string maxLen 截断", () => {
    const r = parseLLMJSON('[{"code":"12345678901234567890"}]', SIMPLE) as any[];
    expect(r[0].code).toBe("1234567890");
  });

  it("eventClassify 真实 task：catalystScore clamp + level 枚举", () => {
    const r = parseLLMJSON('[{"title":"央行降准","level":"政策","catalystScore":150,"timeSensitivity":"即时"}]', schemaForTask("eventClassify")) as any[];
    expect(r[0].catalystScore).toBe(100);
    expect(r[0].level).toBe("政策");
  });

  it("schema 未注册 task → 纯容错解析（无归一化）", () => {
    const r = parseLLMJSON('[{"x":1}]', undefined);
    expect(r).toEqual([{ x: 1 }]);
  });
});

describe("v9.87.0 注册表完备性", () => {
  it("前端注册表含全部高频 JSON task", () => {
    for (const t of ["eventClassify", "mainlineRank", "dailyIntel", "stockNewsScore", "themeNewsScore", "annRank", "leaderPredict", "riskRadar", "nextDayScenarios", "mainlineDiagnosis", "criticReview", "factorAttribution", "eventDeepDive"]) {
      expect(LLM_JSON_TASKS[t], t).toBeDefined();
    }
  });

  it("schemaForTask 对未注册 task 返回 undefined", () => {
    expect(schemaForTask("quickChat")).toBeUndefined();
  });
});

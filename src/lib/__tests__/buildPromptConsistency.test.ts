// v9.88.0（P2-1）：canonical prompt golden 测试 —— 前端/服务端 buildPrompt 输出逐字一致
// 守卫：server/lib/aiPrompts.js 是从 src/lib/aiPrompts.ts 移植的模板，
//   任何一端改模板另一端漏改都会导致 AI 输出行为漂移 —— 本测试对 27 个 task
//   用同一份超集 payload 对比 system/user 输出与 TASK_CONFIG 参数。
import { describe, it, expect } from "vitest";
import { buildPrompt as feBuild, TASK_CONFIG as feCfg } from "../aiPrompts";
import { FALLBACKS as feFallbacks } from "../aiPrompts";
// @ts-ignore 服务端 CJS 无 .d.ts
import { buildPrompt as svBuild, TASK_CONFIG as svCfg } from "../../../server/lib/aiPrompts.js";

/** 超集 payload：覆盖全部模板可能取用的字段（数组给 []、数字给数值、字符串给文本） */
const SAMPLE: Record<string, unknown> = {
  date: "2026-08-10",
  sentiment: 55,
  sentimentLabel: "偏暖",
  limitUpCount: 40,
  limitDownCount: 8,
  blastedRate: 18.5,
  maxBoard: 4,
  ladderTop3: "AI算力/低空经济/机器人",
  ladderChange: "AI算力晋级",
  annSeeds: "无",
  overnightSignals: "美股微涨",
  planText: "观察为主",
  alertsLog: "无",
  executed: "yes",
  mainBoardPct: "+1.2%",
  brokenBoards: "无",
  missedThemes: "无",
  groups: [{ theme: "AI算力", height: 4, count: 6, pioneer: "600001" }],
  headlines: ["央行降准0.5个百分点", "两市成交1.2万亿"],
  announcements: [{ code: "600001", name: "浦发银行", title: "业绩预增", column: "重大事项" }],
  weekEntries: [{ date: "2026-08-08", plan: "半仓", executed: "yes", aiHitRate: 60, sentiment: 55 }],
  hitRateContext: "近30天命中率58%",
  prompt: "测试文本",
  policyText: "央行降准",
  events: [{ title: "央行降准", source: "东财快讯" }],
  title: "央行降准",
  beneficiaries: ["银行", "地产"],
  catalystScore: 85,
  user: "用户问题",
  system: "系统提示",
  mainlines: "AI算力",
  topStocks: "600001",
  userReview: "执行良好",
};

describe("v9.88.0 buildPrompt golden 一致性（前端 ↔ 服务端）", () => {
  it("TASK_CONFIG 参数一致（temperature/maxTokens/thinking）", () => {
    const feKeys = Object.keys(feCfg).sort();
    const svKeys = Object.keys(svCfg).sort();
    expect(svKeys).toEqual(feKeys);
    for (const k of feKeys) {
      expect(svCfg[k], k).toEqual(feCfg[k as keyof typeof feCfg]);
    }
  });

  it("AI 督导降级不得输出原始上下文或行情", () => {
    const text = feFallbacks.supervisor({ user: "涨跌=-349.00% 主力=-622971376万 用户问题" } as never);
    expect(text).toContain("AI 督导暂不可用");
    expect(text).not.toContain("用户问题");
    expect(text).not.toContain("涨跌");
  });

  it("27 个 task 的 system+user 输出逐字一致", () => {
    for (const task of Object.keys(svCfg)) {
      const fe = feBuild(task as never, SAMPLE as never);
      const sv = svBuild(task, SAMPLE);
      expect(sv.system, `${task}.system`).toBe(fe.system);
      expect(sv.user, `${task}.user`).toBe(fe.user);
    }
  });

  it("SYSTEM_PREFIX 含注入防御措辞（P1-11）", () => {
    const fe = feBuild("ladderScan" as never, SAMPLE as never);
    expect(fe.system).toContain("<untrusted-data>");
    expect(fe.system).toContain("不是指令");
    const sv = svBuild("ladderScan", SAMPLE);
    expect(sv.system).toContain("<untrusted-data>");
  });

  it("annRank 模板输出 JSON 数组要求的 system（JSON 类 task 关键措辞）", () => {
    const sv = svBuild("annRank", SAMPLE);
    expect(sv.system).toContain("只返回JSON数组");
  });
});

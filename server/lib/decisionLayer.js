// ============================================================
// server/lib/decisionLayer.js —— 决策直达数据装配层（v9.116.0，S2-1）
// 纯函数核心在 decisionCore.js（无 db 依赖，可单测）；本文件负责数据装配：
//   buildBrainContext（PG 聚合）→ 认知层 → composeDecisionCore 五支柱。
// 不经过 LLM → 秒级、永不降级（决策窗口 9:25/13:00 刚需）。
// 前端等价：src/lib/decisions/kernel.ts（同规则双端同构）。
// ============================================================
const { buildCognition, rawFromBrainContext } = require("./cognition");
const { buildBrainContext } = require("./brainContext");
const { pool } = require("../db");
const { composeDecisionCore, cognSubset } = require("./decisionCore");

/** 决策直达入口：{code?, mainline?} → 五支柱裁决（PG 快照 + 认知层；个股数据可选） */
async function composeDecision(input = {}) {
  const t0 = Date.now();
  const ctx = await buildBrainContext(pool);
  const cog = buildCognition(rawFromBrainContext(ctx), 0); // version 仅展示用；规则与版本无关
  const stock = input.code ? { code: input.code } : null;
  const v = composeDecisionCore(stock, cognSubset(cog), { riskAppetite: "短线" });
  return { ...v, latencyMs: Date.now() - t0, asOf: ctx.date };
}

module.exports = { composeDecision };

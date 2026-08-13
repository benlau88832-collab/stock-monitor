// ============================================================
// server/lib/thresholds.js —— 服务端业务阈值单一来源（v9.135.0，游资改造·阶段四）
// 与前端 src/lib/thresholds.ts 双端同构（thresholdsGolden.test.js 锁定数值一致，单侧改动必红）。
// 历史：炸板率"偏高"在服务端同时存在 15%（情绪周期分歧）/20%（风险 trap）/35%·20%（因子 IC）
//   三套口径——收敛为本文件；业务语义注释与前端对应常量互相引用。
// ============================================================

/** 炸板率（%） */

// 情绪周期分歧分界（deriveSentimentStage 用；对应前端 emotionStage.deriveStage 的 >15 判据）
const BLAST_DIVERGE_PCT = 15;
// 风险等级"炸板率偏高"trap 触发（buildRisk 用；对应前端认知风险阈值 20）
const BLAST_RISK_PCT = 20;
// 因子 IC 健康度：炸板率高/低分档（factorIc 用；对应前端 thresholds.BLAST_RATE_HIGH/LOW）
const BLAST_HIGH_IC = 35;
const BLAST_LOW_IC = 20;
// v9.136.0（任务3 收口）：炸板率突变警戒（intradayRules R3 用；语义=封板转弱突变，
//   数值与 IC 分档一致但独立命名——语义域不同（突变 vs 健康度），防单边调整牵连）
const BLAST_SURGE_FROM = 20; // 上轮炸板率低于此视为封板健康
const BLAST_SURGE_TO = 35;   // 本轮炸板率达到此视为突变（封板转弱）

module.exports = { BLAST_DIVERGE_PCT, BLAST_RISK_PCT, BLAST_HIGH_IC, BLAST_LOW_IC, BLAST_SURGE_FROM, BLAST_SURGE_TO };

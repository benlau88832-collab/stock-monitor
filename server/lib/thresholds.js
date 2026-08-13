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

module.exports = { BLAST_DIVERGE_PCT, BLAST_RISK_PCT, BLAST_HIGH_IC, BLAST_LOW_IC };

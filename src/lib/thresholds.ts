// ============================================================
// v9.62（V9-L1）：市场概念阈值集中管理
// 为什么：同一天"炸板率偏高"在 anomalyTier 是 40%、factorLib 是 35%、sysRiskGuard 是 50%，
// 各模块各算各的 → 调参翻 N 个文件、口径打架、同一屏显示不同判断。
// 原则：按"业务概念"命名（不是按模块），所有模块引用同一常量，杜绝魔法数字。
// 注意：本文件只集中"跨模块共享的业务阈值"；模块内部一次性局部判断不强抽（避免过度抽象）。
// ============================================================

// ---------- 炸板率（%） ----------
/** 炸板率 ≥ 此值 = 情绪分歧（封不住板，没人接力）—— factorLib/sysRiskGuard 黄/marketStateMachine 统一 */
export const BLAST_RATE_HIGH = 35;
/** 炸板率 ≥ 此值 = 极端分歧（系统性风险红级） */
export const BLAST_RATE_EXTREME = 50;
/** 炸板率 ≤ 此值 = 封板健康 */
export const BLAST_RATE_LOW = 20;
/** 炸板率 ≥ 此值 = 开始分歧（震荡预警，低于"高"档） */
export const BLAST_RATE_WARN = 30;
/** 炸板率 > 此值 = 防守日（风格判定：涨停潮熄火） */
export const BLAST_RATE_DEFENSE = 45;

// ---------- 情绪分（0-100） ----------
/** 情绪 ≥ 此值 = 极度贪婪 */
export const SENTI_EXTREME_GREED = 80;
/** 情绪 ≥ 此值 = 贪婪 */
export const SENTI_GREED = 65;
/** 情绪 ≥ 此值 = 中性上沿 */
export const SENTI_NEUTRAL_HIGH = 45;
/** 情绪 ≤ 此值 = 恐慌 */
export const SENTI_FEAR = 25;
/** 情绪 ≤ 此值 = 弱势（亏钱效应：情绪低 + 炸板率高） */
export const SENTI_WEAK = 35;
/** 情绪 ≤ 此值 = 冰点（系统性风险红级） */
export const SENTI_ICEBERG = 15;
/** 情绪 ≤ 此值 = 冰点（市场状态机：配合大面积跌停 dp≥15） */
export const SENTI_ICEBERG_STATE = 20;
/** 情绪 ≥ 此值 = 极值（因子：情绪极值反转） */
export const SENTI_EXTREME = 70;
/** 情绪 ≤ 此值 = 极值（因子：情绪极值反转） */
export const SENTI_EXTREME_LOW = 30;

// ---------- 涨停数（只） ----------
/** 涨停 ≥ 此值 = 涨停潮（局部主线/风格进攻的最低要求） */
export const ZT_COUNT_BOOM = 20;
/** 涨停 ≥ 此值 = 亢奋普涨 */
export const ZT_COUNT_EUPHORIA = 40;
/** 涨停 ≥ 此值 = 极热（信号回测：打板信号） */
export const ZT_COUNT_HOT = 50;
/** 涨停 ≤ 此值 = 修复（信号回测：低迷后修复） */
export const ZT_COUNT_REVIVE = 15;

// ---------- 跌停数（只） ----------
/** 跌停 ≥ 此值 = 恐慌蔓延（系统性风险红级） */
export const DT_COUNT_PANIC = 50;
/** 跌停 ≥ 此值 = 风险偏高（黄级） */
export const DT_COUNT_WARN = 20;
/** 跌停 ≥ 此值 = 冰点（配合情绪极低） */
export const DT_COUNT_ICEBERG = 15;

// ---------- 换手率（%） ----------
/** 换手 > 此值 = 交易过度拥挤（个股否决/拥挤度） */
export const TURNOVER_CROWDED = 25;
/** 换手 > 此值 = 极度拥挤 */
export const TURNOVER_OVERHEAT = 20;

// ---------- 个股异动（无 standards 时的规则阈值） ----------
/** 涨幅 ≥ 此值 = 异动 */
export const PULSE_PCT_HIGH = 7;
/** 量比 ≥ 此值 = 异动 */
export const PULSE_VR_HIGH = 3;
/** 量比 ≥ 此值 = 极端异动 */
export const PULSE_VR_EXTREME = 5;
/** 换手 ≥ 此值 = 异动 */
export const PULSE_TURNOVER_HIGH = 15;
/** 换手 ≥ 此值 = 轻度异动 */
export const PULSE_TURNOVER_MID = 8;
/** 涨幅 ≥ 此值 = 轻度异动 */
export const PULSE_PCT_MID = 3;
/** 量比 ≥ 此值 = 轻度异动 */
export const PULSE_VR_MID = 1.5;

// ---------- 大盘（沪深300 涨跌幅 %） ----------
/** 沪深300 ≤ 此值 = 系统性杀跌（红级） */
export const HS300_CRASH = -2;
/** 沪深300 ≤ 此值 = 风险偏高（黄级） */
export const HS300_WARN = -1;

// ---------- 主线强度分（0-100，mainlineScore/mainline 风格） ----------
export const STRENGTH_STRONG = 80;
export const STRENGTH_WATCH = 60;
/** 风格进攻：风险偏好 ≥ 此值 */
export const RISK_APPETITE_ATTACK = 65;
/** 风格防守：风险偏好 ≤ 此值 */
export const RISK_APPETITE_DEFENSE = 35;
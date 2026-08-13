// ============================================================
// v9.135.0（游资改造·阶段四）：阈值双端 golden ——
//   前端 src/lib/thresholds.ts ↔ 服务端 server/lib/thresholds.js 数值一致锁定（单侧改动必红）。
//   历史教训：thresholds.ts 曾注释"所有模块引用同一常量"但服务端无对应物，双端口径漂移。
// ============================================================
import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import * as FE from "../thresholds";

const require = createRequire(import.meta.url);
const BE = require("../../../server/lib/thresholds.js");

describe("v9.135.0 阈值双端 golden（阶段四）", () => {
  it("炸板率高/低分档双端一致（因子 IC 口径）", () => {
    expect(BE.BLAST_HIGH_IC).toBe(FE.BLAST_RATE_HIGH); // 35
    expect(BE.BLAST_LOW_IC).toBe(FE.BLAST_RATE_LOW);   // 20
  });
  it("情绪周期分歧阈值 15 双端一致（前端 deriveStage 与服务端 BLAST_DIVERGE_PCT）", () => {
    expect(BE.BLAST_DIVERGE_PCT).toBe(15);
    expect(BE.BLAST_RISK_PCT).toBe(20);
  });
  it("前端新增收口常量数值", () => {
    expect(FE.BLAST_RATE_FUSE).toBe(40);
    expect(FE.BLAST_RATE_PENALTY_START).toBe(40);
    expect(FE.BLAST_RATE_LOW_ABSORB_MAX).toBe(30);
  });
  it("v9.136.0（任务3 收口）炸板率突变警戒双端一致（intradayRules R3 语义域）", () => {
    expect(BE.BLAST_SURGE_FROM).toBe(FE.BLAST_SURGE_FROM); // 20
    expect(BE.BLAST_SURGE_TO).toBe(FE.BLAST_SURGE_TO);     // 35
    expect(FE.BLAST_SURGE_FROM).toBe(FE.BLAST_RATE_LOW);   // 与健康分档同值（独立命名防单边牵连）
    expect(FE.BLAST_SURGE_TO).toBe(FE.BLAST_RATE_HIGH);
  });
});

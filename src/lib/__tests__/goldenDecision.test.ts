// ============================================================
// v9.123.0（卓越审查 P2-1）：双端决策核 golden ——
//   server/lib/decisionCore.js（CJS 服务端）与 src/lib/decisions/kernel.ts（TS 前端）
//   同一套规则公式，同输入必须同输出（决策/评分/五支柱/游资战术逐字段比对）。
// 锁定"双端同构"红线：单侧改动另一侧测试即红。
// ============================================================
import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import {
  composeDecisionCore as kernelCore,
  relayEnvScore as kRelay,
  stageActionOf as kStage,
  buyPointOf as kBuy,
  ladderPosOf as kLadder,
} from "../decisions/kernel";

const require = createRequire(import.meta.url);
// server/lib/decisionCore.js 纯函数 CJS（无 IO 依赖，可直接 require）
const dc = require("../../../server/lib/decisionCore.js");

const cog = {
  version: 9,
  session: { phase: "盘中", window: "09:30-11:30", decisionWindow: false },
  risk: { value: { level: "低", traps: [], gateOpen: true } },
  sentiment: { value: { stage: "发酵", score: 75, premium: 2.4 } },
  mainline: { value: { primaryTheme: "半导体", strength: 92, ladder: { tier1: ["龙头甲"], tier2: ["跟风乙"], tier3: [] } } },
  leader: { value: { name: "龙头甲", code: "600001", height: 3, relayOk: true } },
};
const stock = { code: "600519", name: "贵州茅台", pct: 1.2, price: 1700, mainNet: 8e7, turnoverRate: 1.5, limitUp: false, relay: 0 };

describe("v9.123.0 双端决策核 golden（P2-1）", () => {
  it("同输入：decision/score/止损止盈/仓位/战术 双端一致", () => {
    const srv = dc.composeDecisionCore(stock, cog, { riskAppetite: "短线" }, "盘中");
    const fe = kernelCore(stock, cog, { riskAppetite: "短线", sysRisk: { hs300Pct: null, limitDownCount: 0 } }, "盘中");
    expect(fe.decision).toBe(srv.decision);
    expect(fe.score).toBe(srv.score);
    expect(fe.stopLossPct).toBe(srv.stopLossPct);
    expect(fe.targetPct).toBe(srv.targetPct);
    expect(fe.suggestedPositionPct).toBe(srv.suggestedPositionPct);
    expect(JSON.stringify(fe.tactics)).toBe(JSON.stringify(srv.tactics));
  });

  it("五支柱逐柱一致（risk 仅比对 pass/score——前端有 sysRisk 附加说明，口径不同属已知设计）", () => {
    const srv = dc.composeDecisionCore(stock, cog, { riskAppetite: "短线" }, "盘中");
    const fe = kernelCore(stock, cog, { riskAppetite: "短线", sysRisk: { hs300Pct: null, limitDownCount: 0 } }, "盘中");
    expect(JSON.stringify(fe.pillars.admission)).toBe(JSON.stringify(srv.pillars.admission));
    expect(JSON.stringify(fe.pillars.position)).toBe(JSON.stringify(srv.pillars.position));
    expect(JSON.stringify(fe.pillars.exit)).toBe(JSON.stringify(srv.pillars.exit));
    expect(JSON.stringify(fe.pillars.trap)).toBe(JSON.stringify(srv.pillars.trap));
    expect(fe.pillars.risk.pass).toBe(srv.pillars.risk.pass);
    expect(fe.pillars.risk.score).toBe(srv.pillars.risk.score);
  });

  it("战术五件套双端一致（含 v9.123.0 空名守卫）", () => {
    expect(kRelay(cog)).toBe(dc.relayEnvScore(cog));
    expect(kStage("分歧")).toBe(dc.stageActionOf("分歧"));
    expect(kBuy({ code: "x", limitUp: true, relay: 2 }, cog, "盘中")).toBe(dc.buyPointOf({ code: "x", limitUp: true, relay: 2 }, cog, "盘中"));
    expect(kBuy(null, cog, "竞价")).toBe(dc.buyPointOf(null, cog, "竞价"));
    expect(kLadder({ code: "600519" }, cog)).toBe(dc.ladderPosOf({ code: "600519" }, cog));
    expect(kLadder({ code: "x", name: "龙头甲科技" }, cog)).toBe(dc.ladderPosOf({ code: "x", name: "龙头甲科技" }, cog));
  });
});

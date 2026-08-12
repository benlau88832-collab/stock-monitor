// v9.102.0（T-A2）：盘中精灵规则引擎纯函数单测（CJS，vitest 直接 import）
import { describe, it, expect } from "vitest";
// @ts-ignore 服务端 CJS（intradayRules.js 无副作用，可直接 import）
import { evaluatePoolDiff } from "../../../server/lib/intradayRules";

const mk = (code: string, hybk = "半导体", fund = 5e8) => ({ code, name: code, hybk, fund, lbc: 1 });

describe("v9.102.0 evaluatePoolDiff（5 条规则）", () => {
  it("R1 板块涨停家数突变（+2 只）→ A 级事件", () => {
    const prev = { zt: [mk("600001", "半导体")], zb: [], dt: [] };
    const cur = { zt: [mk("600001", "半导体"), mk("600002", "半导体"), mk("600003", "半导体")], zb: [], dt: [] };
    const ev = evaluatePoolDiff(prev, cur);
    const r1 = ev.find((e: any) => e.type === "板块涨停潮");
    expect(r1).toBeDefined();
    expect(r1!.level).toBe("A");
    expect(r1!.board).toBe("半导体");
    expect(r1!.reason).toContain("1→3 只（+2）");
  });

  it("R2 全局涨停 +3 → S 级", () => {
    const prev = { zt: [mk("600001")], zb: [], dt: [] };
    const cur = { zt: [mk("600001"), mk("600002"), mk("600003"), mk("600004")], zb: [], dt: [] };
    const ev = evaluatePoolDiff(prev, cur);
    expect(ev.find((e: any) => e.type === "涨停潮")?.level).toBe("S");
  });

  it("R3 炸板率 10%→50% 突变 → S 级", () => {
    const prev = { zt: [mk("600001"), mk("600002")], zb: [], dt: [] };
    const cur = { zt: [mk("600001")], zb: [mk("600002")], dt: [] }; // 1 板 1 炸 = 50%
    const ev = evaluatePoolDiff(prev, cur);
    expect(ev.find((e: any) => e.type === "炸板率突变")?.level).toBe("S");
  });

  it("R3 炸板率稳定（20%→25%）→ 无事件", () => {
    const prev = { zt: [mk("600001"), mk("600002")], zb: [], dt: [] };
    const cur = { zt: [mk("600001"), mk("600002")], zb: [mk("600003")], dt: [] }; // 2 板 1 炸 = 33%… 上轮 0% <20 本轮 33% <35 → 不触发
    const ev = evaluatePoolDiff(prev, cur);
    expect(ev.find((e: any) => e.type === "炸板率突变")).toBeUndefined();
  });

  it("R4 封单变化率 ≥50% → B 级", () => {
    const prev = { zt: [mk("600001", "半导体", 5e8)], zb: [], dt: [] };
    const cur = { zt: [mk("600001", "半导体", 9e8)], zb: [], dt: [] }; // +80%
    const ev = evaluatePoolDiff(prev, cur);
    const r4 = ev.find((e: any) => e.type === "封单异动");
    expect(r4).toBeDefined();
    expect(r4!.level).toBe("B");
    expect(r4!.reason).toContain("+80%");
  });

  it("无变化 → 无事件", () => {
    const s = { zt: [mk("600001")], zb: [], dt: [] };
    expect(evaluatePoolDiff(s, s)).toHaveLength(0);
  });

  // v9.123.0（T-11）：R3 精确阈值边界（prev<20 且 cur>=35 才触发）
  it("R3 边界：19.9%→35% 触发 S 级；20%→35% 不触发；19.9%→34.99% 不触发", () => {
    const mkN = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => mk(`${prefix}${i}`));
    const prev = { zt: mkN(801, "a"), zb: mkN(199, "b"), dt: [] };   // 199/1000 = 19.9%
    const cur = { zt: mkN(65, "c"), zb: mkN(35, "d"), dt: [] };      // 35/100 = 35%
    expect(evaluatePoolDiff(prev, cur).find((e: any) => e.type === "炸板率突变")?.level).toBe("S");
    const prev20 = { zt: mkN(800, "a"), zb: mkN(200, "b"), dt: [] }; // 200/1000 = 20.0%
    expect(evaluatePoolDiff(prev20, cur).find((e: any) => e.type === "炸板率突变")).toBeUndefined();
    const cur35minus = { zt: mkN(66, "c"), zb: mkN(34, "d"), dt: [] }; // 34/100 = 34.0%
    expect(evaluatePoolDiff(prev, cur35minus).find((e: any) => e.type === "炸板率突变")).toBeUndefined();
  });
});

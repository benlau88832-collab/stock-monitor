// v9.120.0（卓越 S1-1b）：认知推理层单测 —— 共振投票/背离/因果链/变化率/预判/narrative（⑤ 验收 7 例）
import { describe, it, expect } from "vitest";
import { enrichCognition, assessCoherence, deriveDrivers, computeDelta, makeForecast, buildNarrative } from "../reasoning";

// 认知层 stub（共振进攻场景：情绪发酵/资金吸筹/闸门开/龙头健康/主线强）
function cogStub(over = {}) {
  return {
    version: 3,
    asOf: "2026-08-13T10:00:00.000Z",
    session: { phase: "盘中", window: "09:30-11:30", decisionWindow: false, note: "" },
    mainline: { value: { primaryTheme: "半导体", strength: 92, hotspotRotation: "持续", ladder: { tier1: ["A"], tier2: ["B"], tier3: ["C"] } } },
    sentiment: { value: { stage: "发酵", score: 75, premium: 2.4, blastedRate: 12.4 } },
    capital: { value: { signal: "吸筹", netFlow: 48.6, darkVsLight: 18.4 } },
    risk: { value: { level: "低", traps: [], gateOpen: true } },
    leader: { value: { name: "龙头A", code: "600001", height: 3, relayOk: true } },
    ...over,
  };
}

describe("v9.120.0 推理层 assessCoherence（S1-1b）", () => {
  it("5 维度全多 → 共振进攻且 score 高", () => {
    const coh = assessCoherence(cogStub());
    expect(coh.status).toBe("共振进攻");
    expect(coh.score).toBeGreaterThanOrEqual(80);
    expect(coh.conflicts).toHaveLength(0);
  });

  it("情绪多但资金出货 → conflicts 含'量价背离'", () => {
    const coh = assessCoherence(cogStub({ capital: { value: { signal: "出货", netFlow: -12.4, darkVsLight: -6.2 } } }));
    expect(coh.conflicts.join("")).toContain("量价背离");
    expect(coh.score).toBeLessThan(80); // 背离扣分
  });
});

describe("v9.120.0 推理层 deriveDrivers（S1-1b）", () => {
  it("出货时 primaryDriver 含'资金(出货主导)'；利好新闻为催化", () => {
    const raw = { news: [{ title: "央行增量政策落地", sentiment: "利好" }] };
    const drv = deriveDrivers(cogStub({ capital: { value: { signal: "出货", netFlow: -5, darkVsLight: -3 } } }), raw);
    expect(drv.primaryDriver).toContain("资金(出货主导)");
    expect(drv.catalyst).toBe("央行增量政策落地");
    expect(drv.chain.length).toBe(4);
  });
});

describe("v9.120.0 推理层 computeDelta（S1-1b）", () => {
  it("无 prev → hasPrev=false（首帧无环比）", () => {
    expect(computeDelta(cogStub(), null).hasPrev).toBe(false);
  });

  it("score 升 + net 升 + height 升 → trend 含'情绪回升''资金转正''龙头晋级'", () => {
    const prev = cogStub({ sentiment: { value: { stage: "启动", score: 60 } }, capital: { value: { signal: "中性", netFlow: 20 } }, leader: { value: { name: "龙头A", height: 2, relayOk: true } } });
    const d = computeDelta(cogStub(), prev);
    expect(d.hasPrev).toBe(true);
    expect(d.trend).toContain("情绪回升15");
    expect(d.trend).toContain("资金转正流入");
    expect(d.trend).toContain("龙头晋级1板");
  });
});

describe("v9.120.0 推理层 makeForecast（S1-1b）", () => {
  it("发酵 → conditions 含'高低切'（首条条件）", () => {
    const coh = assessCoherence(cogStub());
    const fc = makeForecast(cogStub(), coh);
    expect(fc.conditions[0].iff).toContain("炸板率>20%");
    expect(fc.conditions[0].then).toContain("高低切");
  });

  it("高潮 → 首分歧预警；退潮 → 防守等待冰点回暖", () => {
    // 分支顺序：共振进攻/发酵 优先 → 高潮/退潮场景需非共振 coh（≥2 维 off）才能命中对应分支
    const cohWeak = assessCoherence(cogStub({
      risk: { value: { level: "高", traps: ["炸板率偏高"], gateOpen: false } },
      capital: { value: { signal: "出货", netFlow: -12.4, darkVsLight: -6.2 } },
    }));
    expect(cohWeak.status).not.toBe("共振进攻");
    const fcH = makeForecast(cogStub({ sentiment: { value: { stage: "高潮", score: 88 } } }), cohWeak);
    expect(fcH.nextWindow).toContain("首分歧");
    const fcD = makeForecast(cogStub({ sentiment: { value: { stage: "退潮", score: 30 } } }), cohWeak);
    expect(fcD.nextWindow).toContain("防守");
  });
});

describe("v9.120.0 推理层 enrichCognition（S1-1b）", () => {
  it("同输入确定性输出 + narrative 含共振状态/驱动/前瞻", () => {
    const raw = { news: [] };
    const a = enrichCognition(cogStub(), raw, null);
    const b = enrichCognition(cogStub(), raw, null);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // 纯函数确定性
    expect(a.coherence.status).toBe("共振进攻");
    expect(a.narrative).toContain("共振进攻");
    expect(a.narrative).toContain("前瞻");
    expect(a.provenance.caliber).toContain("共振=跨5维度");
  });
});

describe("v9.120.0 推理层 buildNarrative（S1-1b）", () => {
  it("背离场景 narrative 含'背离提醒'", () => {
    const cog = cogStub({ capital: { value: { signal: "出货", netFlow: -12.4, darkVsLight: -6.2 } } });
    const coh = assessCoherence(cog);
    const drv = deriveDrivers(cog, { news: [] });
    const fc = makeForecast(cog, coh);
    expect(buildNarrative(cog, coh, drv, fc)).toContain("背离提醒");
  });
});

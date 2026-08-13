// ============================================================
// v9.136.0（主线单源）：认知锚定纯函数单测 ——
//   anchorCognitionMainline（App 候选锚定）/ buildCognitionGroup（补位组构造）/ anchorDisplay（渲染层锚定）
// 验收：同屏 五问条/作战卡/认知横幅 主线名完全一致（锚定后 display[0]/candidates[0] === cognMainline）
// ============================================================
import { describe, it, expect } from "vitest";
import { anchorCognitionMainline, buildCognitionGroup, anchorDisplay } from "../cognitionMainline";
import type { MainlineGroup } from "../stockToMainline";

function mkGroup(mainline: string, strength = 50): MainlineGroup {
  return {
    mainline, ztCount: 3, height: 2, mainNet: 1e8, mainNet5d: 5e7, boardPct: 2,
    newsTitles: [], isPulse: false, logic: "", caution: "", score: strength,
    strengthScore: strength,
    fromLLM: false,
    leaders: [{ code: "600000", name: "龙一", role: "龙一", boardCount: 1, firstBoardTime: "", sealFund: 0, amount: 0, pct: 0, reason: "", popularRank: -1 }],
  };
}

describe("v9.136.0 anchorCognitionMainline（候选锚定）", () => {
  it("认知主线在候选第二位 → 置顶", () => {
    const cands = [mkGroup("A", 70), mkGroup("B", 60), mkGroup("C", 50)];
    const r = anchorCognitionMainline(cands, "B", null);
    expect(r.anchored).toBe(true);
    expect(r.fromServer).toBe(false);
    expect(r.list[0].mainline).toBe("B");
    expect(r.list.map(c => c.mainline)).toEqual(["B", "A", "C"]);
  });

  it("认知主线已是第一 → 原样返回", () => {
    const cands = [mkGroup("A", 70), mkGroup("B", 60)];
    const r = anchorCognitionMainline(cands, "A", null);
    expect(r.anchored).toBe(true);
    expect(r.list).toEqual(cands);
  });

  it("候选无认知主线 → theme_analysis 补位（找同名主题）", () => {
    const cands = [mkGroup("A", 70)];
    const ta = { themes: [
      { theme: "B", ztCount: 9, height: 4, strength: 88, verdict: "领涨龙头", evidence: [{ title: "B利好" }], picks: [{ code: "600001", name: "B龙一", aiVerdict: "可买", buyTrigger: "竞价高开" }] },
      { theme: "C", heat: 50 },
    ] };
    const r = anchorCognitionMainline(cands, "B", ta);
    expect(r.anchored).toBe(true);
    expect(r.fromServer).toBe(true);
    expect(r.list[0].mainline).toBe("B");
    expect(r.list[0].ztCount).toBe(9);
    expect(r.list[0].height).toBe(4);
    expect(r.list[0].strengthScore).toBe(88);
    expect(r.list[0].leaders[0].name).toBe("B龙一");
    expect(r.list[0].leaders[0].role).toBe("龙一");
  });

  it("补位找不到同名主题 → 取 themes[0] 兜底", () => {
    const cands = [mkGroup("A", 70)];
    const ta = { themes: [{ theme: "Z", strength: 60 }] };
    const r = anchorCognitionMainline(cands, "NOPE", ta);
    expect(r.fromServer).toBe(true);
    expect(r.list[0].mainline).toBe("Z");
  });

  it("无认知主线 / 数据不足 / 空候选 → 不锚定", () => {
    expect(anchorCognitionMainline([mkGroup("A")], undefined, null).anchored).toBe(false);
    expect(anchorCognitionMainline([mkGroup("A")], "数据不足", null).anchored).toBe(false);
    expect(anchorCognitionMainline([], "B", null).anchored).toBe(false);
  });

  it("theme_analysis 缺失（服务端不可用）→ 保持前端引擎排序", () => {
    const cands = [mkGroup("A", 70), mkGroup("B", 60)];
    const r = anchorCognitionMainline(cands, "C", null);
    expect(r.anchored).toBe(false);
    expect(r.list).toEqual(cands);
  });
});

describe("v9.136.0 buildCognitionGroup（补位组构造）", () => {
  it("picks 映射为龙一/龙二/龙三，evidence → newsTitles", () => {
    const g = buildCognitionGroup({
      theme: "算力", ztCount: 6, height: 3, strength: 75, verdict: "领涨龙头",
      evidence: [{ title: "算力利好" }],
      picks: [
        { code: "600001", name: "A", aiVerdict: "可买", buyTrigger: "低吸" },
        { code: "600002", name: "B" },
        { code: "600003", name: "C" },
      ],
    });
    expect(g.mainline).toBe("算力");
    expect(g.leaders.map(l => l.role)).toEqual(["龙一", "龙二", "龙三"]);
    expect(g.leaders[0].reason).toContain("可买");
    expect(g.newsTitles).toEqual(["算力利好"]);
    expect(g.caution).toBe("");
  });

  it("风险警示主题 → caution 提示", () => {
    const g = buildCognitionGroup({ theme: "X", verdict: "风险警示", picks: [] });
    expect(g.caution).toBe("风险警示");
  });
});

describe("v9.136.0 anchorDisplay（渲染层锚定，llmRanked 场景）", () => {
  it("llmRanked 首项非认知主线 → 同名项置顶", () => {
    const display = [{ board: "A" }, { board: "B" }, { board: "C" }];
    const r = anchorDisplay(display, "C", [mkGroup("A")]);
    expect(r.map(d => d.board)).toEqual(["C", "A", "B"]);
  });

  it("llmRanked 无认知主线 → candidates 补同名组", () => {
    const display = [{ board: "A" }, { board: "B" }];
    const r = anchorDisplay(display, "C", [mkGroup("A", 90), mkGroup("C", 80)]);
    expect(r[0].board).toBe("C");
    expect((r[0] as { strengthScore?: number }).strengthScore).toBe(80);
    expect(r.map(d => d.board)).toEqual(["C", "A", "B"]);
  });

  it("无认知主线 / 已是第一 → 原样", () => {
    expect(anchorDisplay([{ board: "A" }], undefined, []).map(d => d.board)).toEqual(["A"]);
    expect(anchorDisplay([{ board: "A" }], "A", []).map(d => d.board)).toEqual(["A"]);
  });
});

// v9.92.3-fix（用户报障）：主线诊断 LLM 输出硬约束测试
// 背景：诊断"新能源车"主线，LLM 却输出"核心：百花医药"（医药股）—— 幻觉。
// 约束：leader 字段只能引用输入 leaders 名单内的股票名；剔除后为空用输入 leaders 兜底。
import { describe, it, expect } from "vitest";
import { constrainLeaders } from "../../components/MainlineDiagnosisCard";

const leaders = [
  { name: "秦安股份", code: "603758", role: "龙一" as const, boardCount: 2, firstBoardTime: "", sealFund: 0, amount: 0, pct: 0, reason: "", popularRank: -1 },
  { name: "新亚制程", code: "002388", role: "龙二" as const, boardCount: 1, firstBoardTime: "", sealFund: 0, amount: 0, pct: 0, reason: "", popularRank: -1 },
  { name: "圣阳股份", code: "002580", role: "龙三" as const, boardCount: 1, firstBoardTime: "", sealFund: 0, amount: 0, pct: 0, reason: "", popularRank: -1 },
];

describe("constrainLeaders 诊断幻觉约束（v9.92.3）", () => {
  it("用户报障场景：LLM 输出医药股（百花医药）→ 全部剔除，兜底用输入 leaders", () => {
    const r = constrainLeaders(leaders, ["百花医药"], ["开开实业"], ["百普赛斯"]);
    expect(r.core).toEqual(["秦安股份"]);
    expect(r.follower).toEqual(["新亚制程", "圣阳股份"]);
    expect(r.hype).toEqual([]);
  });

  it("LLM 输出与输入一致 → 原样保留", () => {
    const r = constrainLeaders(leaders, ["秦安股份"], ["新亚制程"], ["圣阳股份"]);
    expect(r.core).toEqual(["秦安股份"]);
    expect(r.follower).toEqual(["新亚制程"]);
    expect(r.hype).toEqual(["圣阳股份"]);
  });

  it("部分合法部分幻觉 → 合法保留，空档兜底", () => {
    const r = constrainLeaders(leaders, ["秦安股份", "贵州茅台"], ["新亚制程"], []);
    expect(r.core).toEqual(["秦安股份"]);
    expect(r.follower).toEqual(["新亚制程"]);
    expect(r.hype).toEqual([]);
  });

  it("非数组输入（string/undefined）→ 不崩溃", () => {
    const r = constrainLeaders(leaders, undefined, "新亚制程" as unknown as string[], undefined);
    expect(Array.isArray(r.core)).toBe(true);
    expect(Array.isArray(r.follower)).toBe(true);
    expect(r.hype).toEqual([]);
  });
});

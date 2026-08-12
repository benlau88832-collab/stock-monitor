// v9.108.0（T-2 P1-4）：isSimpleQuestion 个股类误判修复单测
// 个股问题（6位代码/2-4字股名+问股动词）→ MUST 走 ReAct（false）；纯询问仍走流式（true）
import { describe, it, expect } from "vitest";
import { isSimpleQuestion } from "../assistantAgent";

describe("v9.108.0 isSimpleQuestion 个股探测（T-2 P1-4）", () => {
  it("6位代码 → 走 ReAct", () => {
    expect(isSimpleQuestion("600519能不能上")).toBe(false);
    expect(isSimpleQuestion("600519 怎么样")).toBe(false);
  });

  it("2-4字股名 + 问股动词 → 走 ReAct", () => {
    expect(isSimpleQuestion("贵州茅台怎么样")).toBe(false);
    expect(isSimpleQuestion("百花医药为什么涨停")).toBe(false);
    expect(isSimpleQuestion("太极实业还能买吗")).toBe(false);
  });

  it("回归：纯情绪询问仍走流式", () => {
    expect(isSimpleQuestion("今天情绪如何")).toBe(true);
    expect(isSimpleQuestion("情绪现在多少分")).toBe(true);
    // 注："市场情绪怎么样"命中 2-4字+怎么样 个股正则 → 走 ReAct（指令 T-2 明确可接受：多一次工具调用，ReAct 也能答）
  });

  it("回归：消息类仍走 ReAct", () => {
    expect(isSimpleQuestion("有什么消息")).toBe(false);
    expect(isSimpleQuestion("今天有什么政策")).toBe(false);
  });
});

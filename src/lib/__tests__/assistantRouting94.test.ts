// v9.94.2（AI 助手 ReAct 自主决策）：分析意图问题必须放行 ReAct（不拦截、不短路）
//   —— 含"重要/走势/美股"等分析意图词的消息类问题 → isSimpleQuestion 必须返回 false（走 ReAct）
import { describe, it, expect } from "vitest";
import { isSimpleQuestion } from "../assistantAgent";

describe("v9.94.2 ReAct 自主决策路由", () => {
  it("含分析意图的消息/美股问题 → 必须走 ReAct（isSimpleQuestion=false）", () => {
    expect(isSimpleQuestion("今天有什么重要的新闻，今晚美股走势如何")).toBe(false);
    expect(isSimpleQuestion("周末有什么重要消息，怎么解读")).toBe(false);
    expect(isSimpleQuestion("美股隔夜走势怎么看")).toBe(false);
    expect(isSimpleQuestion("今天的新闻对明天大盘有什么影响")).toBe(false);
  });

  it("纯查询（无分析意图）→ 快捷直出（isSimpleQuestion=false 走 ReAct 读本地快讯）", () => {
    expect(isSimpleQuestion("今天有什么消息")).toBe(false);
    expect(isSimpleQuestion("最近三天有什么公告")).toBe(false);
  });

  it("纯情绪/解释类简单问答 → 真流式（isSimpleQuestion=true）", () => {
    // v9.108.0（T-2 P1-4）：个股探测优先 —— "市场情绪怎么样"命中 2-4字+怎么样 个股正则 → 走 ReAct（指令明确可接受）
    expect(isSimpleQuestion("情绪现在多少分")).toBe(true);
    expect(isSimpleQuestion("涨停是什么意思")).toBe(true);
    expect(isSimpleQuestion("主力资金流向如何")).toBe(true);
  });
});

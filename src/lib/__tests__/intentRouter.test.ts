// v9.113.0（T2-1）：意图路由单测 —— 五档各 2 例 + 默认兜底
import { describe, it, expect } from "vitest";
import { classifyIntent } from "../intentRouter";

describe("v9.113.0 classifyIntent（意图路由）", () => {
  it("summary：纯摘要/大盘问 → 流式", () => {
    expect(classifyIntent("一句话总结今日大盘")).toBe("summary");
    expect(classifyIntent("用一段话概述今天市场情况")).toBe("summary");
  });

  it("data：纯数据问 → 直读 PG", () => {
    expect(classifyIntent("今天涨停多少只")).toBe("data");
    expect(classifyIntent("现在市场情绪多少分")).toBe("data");
  });

  it("decision：决策问 → 决策直达", () => {
    expect(classifyIntent("600519能不能上车")).toBe("decision");
    expect(classifyIntent("医药主线现在能加仓吗")).toBe("decision");
  });

  it("react：消息/主线/外围 → ReAct", () => {
    expect(classifyIntent("今天主线是什么哪些是龙头跟风")).toBe("react");
    expect(classifyIntent("周末有什么重要消息")).toBe("react");
  });

  it("research：深度调研", () => {
    expect(classifyIntent("个股深度调研 600519")).toBe("research");
  });

  it("默认兜底：未命中 → summary（最可靠）", () => {
    expect(classifyIntent("随便聊聊")).toBe("summary");
  });
});

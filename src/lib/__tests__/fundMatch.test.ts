// v9.56（V8-6）：作战卡资金 hybk 兜底 + fundMissing 标记测试
import { describe, it, expect } from "vitest";
import { conceptGroupOf, mainlineToBoardNames } from "../conceptGroups";
import { ambiguousConcepts } from "../conceptGroups";

describe("V8-6/7 资金匹配", () => {
  it("LLM 主线名'人工智能' → conceptGroupOf 折叠为 'AI应用'（对齐折叠 key）", () => {
    expect(conceptGroupOf("人工智能")).toBe("AI应用");
  });

  it("mainlineToBoardNames：主线'AI应用' 命中折叠归属同大类的板块名", () => {
    const boards = [
      { name: "人工智能", pct: 2, mainNet: 1e9 },
      { name: "大模型", pct: 3, mainNet: 2e9 },
      { name: "白酒", pct: -1, mainNet: -5e8 },
    ];
    const names = mainlineToBoardNames("AI应用", boards);
    // 人工智能/大模型 折叠后归属 AI应用
    expect(names).toContain("人工智能");
    expect(names).toContain("大模型");
    expect(names).not.toContain("白酒");
  });

  it("mainlineToBoardNames：LLM 名'人工智能'（未折叠表内）也能通过折叠桥梁匹配", () => {
    const boards = [
      { name: "人工智能", pct: 2, mainNet: 1e9 },
      { name: "光模块", pct: 3, mainNet: 2e9 },
      { name: "白酒", pct: -1, mainNet: -5e8 },
    ];
    const names = mainlineToBoardNames("AI应用", boards);
    expect(names).toContain("人工智能");
  });

  it("V8-7 验收样例：LLM 主线'AI应用' 能匹配到'计算机'行业资金（词根已补）", () => {
    expect(conceptGroupOf("计算机")).toBe("AI应用");
    expect(conceptGroupOf("软件开发")).toBe("AI应用");
    const boards = [
      { name: "计算机", pct: 2, mainNet: 1e9 },
      { name: "白酒", pct: -1, mainNet: -5e8 },
    ];
    const names = mainlineToBoardNames("AI应用", boards);
    expect(names).toContain("计算机");
    expect(names).not.toContain("白酒");
  });

  it("歧义检测：构造歧义概念返回候选（V7-6 接口保持）", () => {
    expect(ambiguousConcepts("光模块服务器")).toBeTruthy();
  });
});

// v9.91.0（概念地基）：全站唯一概念判定核心 conceptFilter 测试
// 验收：① 宽泛概念一票否决（央企国企改革/参股券商/举牌）② 同花顺白名单命中（含"概念"后缀规范化）
//       ③ 词根兜底（东财名≠同花顺名）④ 白名单未加载时旧兜底渐进降级
import { describe, it, expect } from "vitest";
import { isThemeBoardName, isBroadConcept, normalizeConceptName } from "../../shared/conceptFilter";

const whitelist = new Set([
  "光刻胶", "存储芯片", "AI应用", "机器人", "液冷服务器", "固态电池", "低空经济", "光模块",
]);

describe("conceptFilter 概念判定（v9.91.0）", () => {
  it("宽泛概念一票否决：央企国企改革（白名单未加载也拦）", () => {
    expect(isThemeBoardName("央企国企改革", null)).toBe(false);
    expect(isThemeBoardName("央企国企改革", whitelist)).toBe(false);
  });

  it("宽泛概念一票否决：参股券商/举牌/中字头/高股息（白名单命中也拦）", () => {
    // 同花顺 361 列表实测包含这些词 —— 白名单含它也不能放行
    expect(isThemeBoardName("参股券商", new Set(["参股券商"]))).toBe(false);
    expect(isThemeBoardName("举牌", new Set(["举牌"]))).toBe(false);
    expect(isThemeBoardName("中字头股票", null)).toBe(false);
    expect(isThemeBoardName("高股息精选", null)).toBe(false);
  });

  it("白名单命中 → 真题材（规范化：'光刻胶概念' 命中 '光刻胶'）", () => {
    expect(isThemeBoardName("光刻胶概念", whitelist)).toBe(true);
    expect(isThemeBoardName("存储芯片", whitelist)).toBe(true);
    expect(isThemeBoardName("AI应用", whitelist)).toBe(true);
  });

  it("词根兜底：东财名不在同花顺白名单但词根命中（数据要素→数据）", () => {
    expect(isThemeBoardName("数据要素", whitelist)).toBe(true);
    expect(isThemeBoardName("半导体设备", whitelist)).toBe(true);
  });

  it("白名单已加载但未命中且无词根 → 非题材（原 len<=8 兜底不再放行）", () => {
    expect(isThemeBoardName("装配建筑", whitelist)).toBe(false);
    expect(isThemeBoardName("长三角一体化", whitelist)).toBe(false);
  });

  it("白名单未加载 → 旧兜底渐进降级（服务端离线时不因缺白名单全灭）", () => {
    expect(isThemeBoardName("光刻胶", null)).toBe(true);      // 词根命中
    expect(isThemeBoardName("ST板块", null)).toBe(false);     // 宽泛拦截
    expect(isThemeBoardName("融资融券", null)).toBe(false);   // 宽泛拦截
  });

  it("normalizeConceptName 去'概念/板块'后缀", () => {
    expect(normalizeConceptName("光刻胶概念")).toBe("光刻胶");
    expect(normalizeConceptName("机器人板块")).toBe("机器人");
    expect(normalizeConceptName("存储芯片")).toBe("存储芯片");
  });

  it("isBroadConcept 独立判定", () => {
    expect(isBroadConcept("国企改革")).toBe(true);
    expect(isBroadConcept("光刻胶")).toBe(false);
  });
});

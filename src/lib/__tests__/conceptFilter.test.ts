// v9.91.0（概念地基）+ v9.91.1（广泛概念精筛）：全站唯一概念判定核心 conceptFilter 测试
// 用户口径：只接受产品/行业级概念；广泛概念（区域战略/政策/资金通道/风格/资本运作/事件）一概拒绝
// 验收：① 广泛概念一票否决（一带一路/长三角/央国企改革/参股券商）② 白名单命中（含"概念"后缀规范化）
//       ③ 词根兜底（东财名≠同花顺名）④ 白名单未加载时旧兜底渐进降级 ⑤ 产品/行业概念不被误伤
import { describe, it, expect } from "vitest";
import { isThemeBoardName, isBroadConcept, normalizeConceptName } from "../../shared/conceptFilter";

const whitelist = new Set([
  "光刻胶", "存储芯片", "AI应用", "机器人", "液冷服务器", "固态电池", "低空经济", "光模块",
  "新能源汽车", "重组蛋白", "跨境电商", "一体化压铸", "华为海思概念股", "MLCC",
]);

describe("conceptFilter 概念判定（v9.91.0/1）", () => {
  it("广泛概念一票否决：区域战略（一带一路/长三角/雄安/大湾区，白名单命中也拦）", () => {
    expect(isThemeBoardName("一带一路", new Set(["一带一路"]))).toBe(false);
    expect(isThemeBoardName("长三角一体化", whitelist)).toBe(false);
    expect(isThemeBoardName("雄安新区", whitelist)).toBe(false);
    expect(isThemeBoardName("粤港澳大湾区", whitelist)).toBe(false);
    expect(isThemeBoardName("自由贸易港", whitelist)).toBe(false);
    expect(isThemeBoardName("海峡两岸", whitelist)).toBe(false);
  });

  it("广泛概念一票否决：政策/体制（数字经济/碳中和/新型城镇化/土地流转/统一大市场）", () => {
    expect(isThemeBoardName("数字经济", whitelist)).toBe(false);
    expect(isThemeBoardName("碳中和", whitelist)).toBe(false);
    expect(isThemeBoardName("新型城镇化", whitelist)).toBe(false);
    expect(isThemeBoardName("土地流转", whitelist)).toBe(false);
    expect(isThemeBoardName("统一大市场", whitelist)).toBe(false);
    expect(isThemeBoardName("三胎概念", whitelist)).toBe(false);
  });

  it("广泛概念一票否决：资金通道/指数/风格/资本运作/事件", () => {
    expect(isThemeBoardName("融资融券", new Set(["融资融券"]))).toBe(false);
    expect(isThemeBoardName("同花顺中特估100", whitelist)).toBe(false);
    expect(isThemeBoardName("中船系", whitelist)).toBe(false);
    expect(isThemeBoardName("证金持股", whitelist)).toBe(false);
    expect(isThemeBoardName("独角兽概念", whitelist)).toBe(false);
    expect(isThemeBoardName("股权转让(并购重组)", whitelist)).toBe(false);
    expect(isThemeBoardName("2026中报预增", whitelist)).toBe(false);
    expect(isThemeBoardName("俄乌冲突概念", whitelist)).toBe(false);
  });

  it("广泛概念一票否决：央企国企/参股/举牌/高股息（白名单命中也拦）", () => {
    // 同花顺 361 列表实测包含这些词 —— 白名单含它也不能放行
    expect(isThemeBoardName("央企国企改革", whitelist)).toBe(false);
    expect(isThemeBoardName("参股券商", new Set(["参股券商"]))).toBe(false);
    expect(isThemeBoardName("举牌", new Set(["举牌"]))).toBe(false);
    expect(isThemeBoardName("中字头股票", null)).toBe(false);
    expect(isThemeBoardName("高股息精选", null)).toBe(false);
    expect(isThemeBoardName("ST板块", null)).toBe(false);
  });

  it("产品/行业概念不被误伤（白名单命中，含易误伤词）", () => {
    expect(isThemeBoardName("光刻胶概念", whitelist)).toBe(true);
    expect(isThemeBoardName("存储芯片", whitelist)).toBe(true);
    expect(isThemeBoardName("AI应用", whitelist)).toBe(true);
    expect(isThemeBoardName("重组蛋白", whitelist)).toBe(true);      // 含"重组"但不拦
    expect(isThemeBoardName("跨境电商", whitelist)).toBe(true);      // 含"跨境"但不拦
    expect(isThemeBoardName("一体化压铸", whitelist)).toBe(true);    // 含"一体化"但不拦
    expect(isThemeBoardName("华为海思概念股", whitelist)).toBe(true); // 含"概念股"但不拦
    expect(isThemeBoardName("新能源汽车", whitelist)).toBe(true);
  });

  it("词根兜底：东财名不在同花顺白名单但词根命中（数据要素→数据）", () => {
    expect(isThemeBoardName("数据要素", whitelist)).toBe(true);
    expect(isThemeBoardName("半导体设备", whitelist)).toBe(true);
  });

  it("白名单已加载但未命中且无词根 → 非题材（原 len<=8 兜底不再放行）", () => {
    expect(isThemeBoardName("交运设备", whitelist)).toBe(false);   // 行业名（申万），非题材
    expect(isThemeBoardName("互联网服务", whitelist)).toBe(false); // 行业名，非题材
    expect(isThemeBoardName("内贸流通", whitelist)).toBe(false);   // 行业名，非题材
    expect(isThemeBoardName("长三角一体化", whitelist)).toBe(false);
  });

  it("白名单未加载 → 旧兜底渐进降级（服务端离线时不因缺白名单全灭）", () => {
    expect(isThemeBoardName("光刻胶", null)).toBe(true);      // 词根命中
    expect(isThemeBoardName("ST板块", null)).toBe(false);     // 广泛拦截
    expect(isThemeBoardName("融资融券", null)).toBe(false);   // 广泛拦截
  });

  it("normalizeConceptName 去'概念/板块'后缀", () => {
    expect(normalizeConceptName("光刻胶概念")).toBe("光刻胶");
    expect(normalizeConceptName("机器人板块")).toBe("机器人");
    expect(normalizeConceptName("存储芯片")).toBe("存储芯片");
  });

  it("isBroadConcept 独立判定", () => {
    expect(isBroadConcept("国企改革")).toBe(true);
    expect(isBroadConcept("一带一路")).toBe(true);
    expect(isBroadConcept("重组蛋白")).toBe(false);
    expect(isBroadConcept("光刻胶")).toBe(false);
  });
});

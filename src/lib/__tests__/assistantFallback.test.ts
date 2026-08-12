// v9.107.0（全站助手架构 · 改动3）：fallbackAnswer 规则兜底单测 + brainContextToText 主线Top3 完整化
import { describe, it, expect } from "vitest";
import { fallbackAnswer, brainContextToText, type BrainContext } from "../assistantAgent";

const SNAPSHOT = `【大脑快照 2026-08-12】情绪68 · 涨停73只 · 炸板率13% · 最高7板 · 昨日涨停溢价3.1%
涨停板块分布：通信20只、医药15只、算力12只、专精特新12只
主线Top3：医药(强度80·发酵期·裁决观望·龙头:百花医药/开开实业/哈药)、算力(强度58·分歧期·裁决观望·龙头:同力天启/城地香江)、专精特新(强度57·分歧期·裁决观望·龙头:蓝盾光电/望变电气)
板块主力净流入Top：通信+1294.47亿、医药-45.21亿
龙虎榜净买入Top：云南锗业+5.20亿、巨轮智能+3.10亿
⚠ 黑天鹅0条
公告强催化：百花医药<untrusted-data>青蒿素概念</untrusted-data>
次日闸门：贪婪·去弱留强
数据截至：2026-08-12:1330
【本地最近2日消息摘要（PG/本地库）】
政策：<untrusted-data>国常会部署新型消费</untrusted-data>；<untrusted-data>证监会完善退市制度</untrusted-data>
重要快讯：<untrusted-data>通信板块集体涨停潮</untrusted-data>；<untrusted-data>医药商业异动</untrusted-data>
公告：<untrusted-data>百花医药青蒿素新进展</untrusted-data>
【页面状态】
当前页面：驾驶舱
当前最强主线：医药（强度80分）
市场情绪：68（贪婪）
用户自选股：上海电力、太极实业、蓝色光标`;

describe("v9.107.0 fallbackAnswer（规则兜底，任何问题都有回答）", () => {
  it("主线类 → 列主线Top3 + 闸门，带统一前缀", async () => {
    const r = await fallbackAnswer(SNAPSHOT, "今日前三的主线和龙头标的是什么");
    expect(r.startsWith("⚠ 规则版（AI 暂不可用")).toBe(true);
    expect(r).toContain("医药(强度80·发酵期·裁决观望·龙头:百花医药/开开实业/哈药)");
    expect(r).toContain("次日闸门");
  });

  it("个股类（代码/名字）→ 快照中该股相关数据，无则明说", async () => {
    const r = await fallbackAnswer(SNAPSHOT, "百花医药为什么涨停");
    expect(r).toContain("百花医药");
    expect(r).toContain("青蒿素");
    const r2 = await fallbackAnswer(SNAPSHOT, "贵州茅台走势如何");
    expect(r2).toContain("本地无 贵州茅台 的盘口数据");
  });

  it("消息类 → 本地最近2日消息摘要（政策优先）", async () => {
    const r = await fallbackAnswer(SNAPSHOT, "周末有什么重要消息");
    expect(r).toContain("国常会部署新型消费");
    expect(r).toContain("证监会完善退市制度");
  });

  it("情绪/行情类 → 市场行 + 涨停板块分布", async () => {
    const r = await fallbackAnswer(SNAPSHOT, "今天情绪如何");
    expect(r).toContain("情绪68");
    expect(r).toContain("涨停板块分布");
  });

  it("其他问题 → 快照通用摘要（非空白）", async () => {
    const r = await fallbackAnswer(SNAPSHOT, "随便聊聊");
    expect(r).toContain("【本地数据摘要】");
    expect(r.length).toBeGreaterThan(20);
  });

  it("reason 透传（empty content/超时分类）", async () => {
    const r = await fallbackAnswer(SNAPSHOT, "今天情绪如何", "empty content/调用失败");
    expect(r.startsWith("⚠ 规则版（AI 暂不可用：empty content/调用失败）")).toBe(true);
  });
});

describe("v9.107.0 brainContextToText（上下文全量注入）", () => {
  const brain: BrainContext = {
    date: "2026-08-12",
    market: { ztCount: 73, blastedRate: 13, maxBoardHeight: 7, premiumAvg: 3.1, sentiment: 68 },
    mainlines: {
      asOf: "2026-08-12:1330",
      top: [
        { theme: "医药", heat: 80, trend: "发酵期", verdict: "观望", action: "", picks: [{ code: "600721", name: "百花医药", correlation: 0.9 }, { code: "600881", name: "开开实业", correlation: 0.8 }] },
        { theme: "算力", heat: 58, trend: "分歧期", verdict: "观望", action: "", picks: [{ code: "605286", name: "同力天启", correlation: 0.7 }] },
      ],
    },
    gate: { mode: "greed", factor: 0.7, label: "贪婪·去弱留强" },
  };
  it("主线 Top3 含强度/趋势/裁决/龙头前3 + 数据截至时间戳", async () => {
    const txt = brainContextToText(brain);
    expect(txt).toContain("主线Top3：医药(强度80·发酵期·裁决观望·龙头:百花医药/开开实业)");
    expect(txt).toContain("算力(强度58·分歧期·裁决观望·龙头:同力天启)");
    expect(txt).toContain("数据截至：2026-08-12:1330");
  });
});

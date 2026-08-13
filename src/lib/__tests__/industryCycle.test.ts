// industryCycle.test.ts —— 景气度评分卡四维引擎（v9.140.0 阶段三 #12）
import { describe, it, expect } from "vitest";
import { assessIndustryCycle, scorePrice, scoreFund, scoreEarnings, scorePolicy, type IndustryCycleInput } from "../industryCycle";
import type { KlineBar } from "../swingStage";

/** 构造板块日K：给定收盘序列，volume 固定 */
function mkKlines(closes: number[], vols: number[] = []): KlineBar[] {
  let prev = closes[0];
  return closes.map((c, i) => {
    const b: KlineBar = { date: `d${i}`, open: prev, close: c, high: Math.max(prev, c) * 1.01, low: Math.min(prev, c) * 0.99, volume: vols[i] ?? 100 };
    prev = c;
    return b;
  });
}

function mkInput(over: Partial<IndustryCycleInput>): IndustryCycleInput {
  return { code: "BK0478", name: "有色金属", klines: mkKlines(Array.from({ length: 70 }, (_, i) => 100 + i * 0.5)), ...over };
}

describe("scorePrice 价格分（60 日周期位置）", () => {
  it("持续上行：站上 MA60 + MA60 向上 + 60日大涨 → 高分", () => {
    const closes = Array.from({ length: 70 }, (_, i) => 100 + i * 0.6); // 60日 +36%
    const r = scorePrice(mkKlines(closes));
    expect(r.aboveMa60).toBe(true);
    expect(r.ma60Up).toBe(true);
    expect(r.pct60d).toBeGreaterThan(30);
    expect(r.score).toBeGreaterThanOrEqual(80);
  });

  it("持续下行：跌破 MA60 + MA60 向下 + 60日大跌 → 低分", () => {
    const closes = Array.from({ length: 70 }, (_, i) => 200 - i * 1.2); // 60日 -56%
    const r = scorePrice(mkKlines(closes));
    expect(r.aboveMa60).toBe(false);
    expect(r.ma60Up).toBe(false);
    expect(r.score).toBeLessThanOrEqual(25);
  });

  it("横盘震荡 → 中性 40-60", () => {
    const closes = Array.from({ length: 70 }, (_, i) => 100 + Math.sin(i / 5) * 2);
    const r = scorePrice(mkKlines(closes));
    expect(r.score).toBeGreaterThanOrEqual(35);
    expect(r.score).toBeLessThanOrEqual(65);
  });

  it("数据不足（<21 根）→ 中性 50 + 依据", () => {
    const r = scorePrice(mkKlines([100, 101, 102]));
    expect(r.score).toBe(50);
    expect(r.signals[0]).toContain("不足");
  });

  it("60日大涨后跌破 MA20 → 高位风险减分", () => {
    // 前 75 日大涨（60 日窗口内 +38%），最后 5 日急跌跌破 MA20
    const closes: number[] = [];
    for (let i = 0; i < 75; i++) closes.push(100 + i * 1.2);
    for (let i = 0; i < 5; i++) closes.push(closes[closes.length - 1] * 0.97);
    const r = scorePrice(mkKlines(closes));
    expect(r.signals.some(s => s.includes("高位风险"))).toBe(true);
  });
});

describe("scoreFund 资金分", () => {
  it("20/60 日持续流入且 10 日仍流入 → 85 分", () => {
    const r = scoreFund(Array.from({ length: 60 }, () => 5e8));
    expect(r.score).toBe(85);
    expect(r.sum20).toBe(1e10);
  });

  it("20 日流入但 10 日转流出 → 65 分（流入放缓）", () => {
    // 最近 20 日：前 10 日强流入(+1.2亿/日) + 后 10 日流出(-0.5亿/日) → sum20>0 且 sum10<0
    const seq = [
      ...Array.from({ length: 10 }, () => 5e8),
      ...Array.from({ length: 10 }, () => 1.2e9),
      ...Array.from({ length: 10 }, () => -5e8),
    ];
    const r = scoreFund(seq);
    expect(r.sum20).toBe(7e9);
    expect(r.sum10).toBe(-5e9);
    expect(r.score).toBe(65);
  });

  it("20/60 日持续流出且 10 日仍流出 → 25 分", () => {
    const r = scoreFund(Array.from({ length: 60 }, () => -5e8));
    expect(r.score).toBe(25);
  });

  it("数据缺失 → 中性 50", () => {
    expect(scoreFund().score).toBe(50);
    expect(scoreFund([]).score).toBe(50);
  });
});

describe("scoreEarnings 业绩分（财报窗口）", () => {
  it("正式报表披露期内 → 高分（75）", () => {
    const windows = [
      { name: "中报", deadline: "2026-08-31", start: "2026-08-01", active: true, daysToDeadline: 10 },
    ];
    const r = scoreEarnings(windows as never);
    expect(r.score).toBe(75);
  });

  it("临近截止（≤7 天）→ 再加分", () => {
    const windows = [
      { name: "三季报", deadline: "2026-10-31", start: "2026-10-01", active: true, daysToDeadline: 5 },
    ];
    const r = scoreEarnings(windows as never);
    expect(r.score).toBeGreaterThan(75);
  });

  it("未来 30 天内窗口 → 62 分", () => {
    const windows = [
      { name: "中报", deadline: "2026-08-31", start: "2026-08-17", active: false, daysToDeadline: 20 },
    ];
    const r = scoreEarnings(windows as never);
    expect(r.score).toBe(62);
  });

  it("无窗口 → 中性 50", () => {
    expect(scoreEarnings([]).score).toBe(50);
  });
});

describe("scorePolicy 政策分", () => {
  it("近7日命中 7+ 条 → 80 分及以上", () => {
    const news = Array.from({ length: 8 }, (_, i) => ({ title: `铜价创新高，` + `政策利好${i}号` }));
    const r = scorePolicy(news, "有色金属");
    expect(r.hits).toBe(8);
    expect(r.score).toBeGreaterThanOrEqual(80);
  });

  it("无命中 → 40 分", () => {
    const r = scorePolicy([{ title: "今日大盘震荡" }], "有色金属");
    expect(r.hits).toBe(0);
    expect(r.score).toBe(40);
  });

  it("近3日命中新鲜度加分（封顶 +10）", () => {
    const now = Date.now();
    const news = [
      { title: "铜价上涨", ts: now - 3600e3 },
      { title: "铜价上涨2", ts: now - 2 * 3600e3 },
      { title: "铜价上涨3", ts: now - 3 * 3600e3 },
      { title: "铜价上涨4", ts: now - 4 * 3600e3 },
    ];
    const r = scorePolicy(news, "有色金属");
    expect(r.recentHits).toBe(4);
    expect(r.score).toBeGreaterThanOrEqual(70); // 基础 60 + 新鲜度
  });

  it("数据缺失 → 中性 50", () => {
    expect(scorePolicy(undefined, "有色金属").score).toBe(50);
  });
});

describe("assessIndustryCycle 汇总", () => {
  it("四维全强 → 景气上行", () => {
    const closes = Array.from({ length: 70 }, (_, i) => 100 + i * 0.6);
    const r = assessIndustryCycle(mkInput({
      klines: mkKlines(closes),
      fundSeq: Array.from({ length: 60 }, () => 5e8),
      earningsWindows: [{ name: "中报", deadline: "2026-08-31", start: "2026-08-01", active: true, daysToDeadline: 10 }] as never,
      news: Array.from({ length: 8 }, (_, i) => ({ title: `铜价上涨政策${i}` })),
    }));
    expect(r.total).toBeGreaterThanOrEqual(70);
    expect(r.stage).toBe("景气上行");
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("四维全弱 → 景气底部", () => {
    const closes = Array.from({ length: 70 }, (_, i) => 200 - i * 1.2);
    const r = assessIndustryCycle(mkInput({
      klines: mkKlines(closes),
      fundSeq: Array.from({ length: 60 }, () => -5e8),
      earningsWindows: [] as never,
      news: [{ title: "大盘震荡" }],
    }));
    expect(r.total).toBeLessThan(40);
    expect(r.stage).toBe("景气底部");
  });

  it("数据不足（K线<21 且无资金）→ 数据不足阶段", () => {
    const r = assessIndustryCycle(mkInput({ klines: mkKlines([100, 101]), fundSeq: undefined }));
    expect(r.stage).toBe("数据不足");
  });

  it("加权口径：价格35%+资金30%+业绩20%+政策15%", () => {
    const input = mkInput({
      klines: mkKlines(Array.from({ length: 70 }, () => 100)), // 横盘 → 价格分约 40-50
      fundSeq: undefined, // 资金 50
      earningsWindows: [] as never, // 业绩 50
      news: [{ title: "x" }], // 政策 40（无命中）
    });
    const r = assessIndustryCycle(input);
    const expectTotal = Math.round(scorePrice(input.klines).score * 0.35 + 50 * 0.3 + 50 * 0.2 + 40 * 0.15);
    expect(r.total).toBe(expectTotal);
  });
});

// 个股评分：五维权重 fund(30)/liquidity(25)/ladder(20)/news(15)/seat(10)
// 纯函数，不碰 DOM/localStorage/网络

// ============== 权重（可调） ==============
const W_FUND = 0.30;
const W_LIQUIDITY = 0.25;
const W_LADDER = 0.20;
const W_NEWS = 0.15;
const W_SEAT = 0.10;

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

// ============== 四象限判断（从 App.tsx 提取为共享） ==============
export function judgeFlowType(openNet: number, darkNet: number): string {
  if (openNet >= 0 && darkNet >= 0) return "共振流入";
  if (openNet < 0 && darkNet < 0) return "共振流出";
  if (openNet >= 0 && darkNet < 0) return "主力承接";
  return "主力撤离";
}

// ============== 否决规则（复用现有全套） ==============
export interface VetoResult {
  vetoed: boolean;
  reasons: string[];
}

/** 利好/利空正则（复用 NewsPanel 已验证的正则） */
const IS_POS = /利好|上涨|增持|分红|业绩预增|中标|新高|扭亏|大涨|突破|批准|获批|合作|签约|回购/;
const IS_NEG = /下跌|利空|暴雷|退市|亏损|减持|违规|处罚|风险|预警|暴跌|崩盘|调查|关税|诉讼|制裁|违约|破产|被罚|终止|叫停|停牌核查/;

export function buildVetoList(stock: StockInput): VetoResult {
  const reasons: string[] = [];
  // 资金结构否决
  if (stock.mainNet < 0 && stock.smallNet > 0) reasons.push("主力净流出而散户净流入");
  // 涨停追高
  if (stock.pct >= stock.limitPct - 0.2) reasons.push("已接近涨停，追高风险");
  // 换手率过高
  if (stock.turnoverRate > 25) reasons.push("换手率>25%，交易过度拥挤");
  // ST
  if (/ST|^\*ST|退/.test(stock.name)) reasons.push("ST/退市风险股");
  // 减持/立案/业绩雷（从新闻/公告标题扫描）
  if (stock.newsHeadlines?.some(h => /减持(计划|进展|完成)/.test(h))) reasons.push("股东减持");
  if (stock.newsHeadlines?.some(h => /立案|行政处罚|警示函|问询函/.test(h))) reasons.push("监管风险");
  if (stock.newsHeadlines?.some(h => /预亏|业绩亏损|商誉减值/.test(h))) reasons.push("业绩雷");
  // 解禁（简化：30日内有解禁记录）
  if (stock.hasLiftBan30d) reasons.push("30日内有解禁");
  return { vetoed: reasons.length > 0, reasons };
}

// ============== 输入类型 ==============
export interface StockInput {
  code: string; name: string; price: number; pct: number;
  mainNet: number; mainNetPct: number; smallNet: number;
  mainNet5d: number; mainNet5dPct: number;
  extraLargeNet: number; largeNet: number; mediumNet: number;
  turnoverRate: number; volumeRatio: number;
  limitPct: number; // 涨跌停幅度
  // 梯队角色
  ladderRole: "最高板" | "先锋" | "中军" | "跟风";
  // 涨停池附加
  inZTPool: boolean;
  sealFundRatio: number | null; // 封单额/成交额
  // 消息
  newsHeadlines?: string[];
  hasLiftBan30d?: boolean;
  // 席位
  seatPremiumHigh: boolean; // 近120日席位含"高溢价"
  inPopularityTop10: boolean; // 登人气榜Top10
}

export interface StockScoreResult {
  code: string; name: string; price: number; pct: number;
  total: number; // 0-100
  factors: { fund: number; liquidity: number; ladder: number; news: number; seat: number };
  vetoed: boolean;
  vetoReasons: string[];
  newsSource: "LLM" | "规则版";
  invalidation: string;
  /** 置信档：≥70 A档 / 55-70 B档 / <55 C档 */
  tier: "A" | "B" | "C";
}

export function computeStockScores(stocks: StockInput[]): StockScoreResult[] {
  const results: StockScoreResult[] = [];

  for (const s of stocks) {
    // 先跑否决
    const veto = buildVetoList(s);
    if (veto.vetoed) {
      results.push({
        code: s.code, name: s.name, price: s.price, pct: s.pct,
        total: 0, factors: { fund: 0, liquidity: 0, ladder: 0, news: 0, seat: 0 },
        vetoed: true, vetoReasons: veto.reasons,
        newsSource: "规则版", invalidation: "", tier: "C",
      });
      continue;
    }

    // -- fund 30% --
    const fundToday = clamp(50 + s.mainNetPct * 10);
    const fund5dDir = s.mainNet5dPct > 1 ? 80 : s.mainNet5dPct > -1 ? 50 : 20;
    const openNet = s.extraLargeNet + s.largeNet;
    const darkNet = s.mediumNet + s.smallNet;
    const quad = judgeFlowType(openNet, darkNet);
    const quadScore = quad === "共振流入" ? 90 : quad === "主力承接" ? 80 : quad === "主力撤离" ? 20 : 0;
    const fund = 0.5 * fundToday + 0.3 * fund5dDir + 0.2 * quadScore;

    // -- liquidity 25% --
    let vrScore: number;
    if (s.volumeRatio >= 1.5 && s.volumeRatio <= 2.5) vrScore = 100;
    else if (s.volumeRatio < 0.8) vrScore = 40;
    else if (s.volumeRatio > 3) vrScore = Math.max(20, 100 - (s.volumeRatio - 3) / 0.5 * 10);
    else vrScore = 70; // 0.8-1.5 or 2.5-3

    let trScore: number;
    if (s.turnoverRate < 3) trScore = 60;
    else if (s.turnoverRate <= 8) trScore = 90;
    else if (s.turnoverRate <= 15) trScore = 80;
    else trScore = 50; // 15-25%

    let sealScore = 50;
    if (s.inZTPool && s.sealFundRatio != null) {
      sealScore = s.sealFundRatio >= 0.2 ? 100 : clamp(s.sealFundRatio / 0.2 * 100);
    }
    const liquidity = (vrScore + trScore + sealScore) / 3;

    // -- ladder 20% --
    const ladderMap: Record<string, number> = { "最高板": 100, "先锋": 90, "中军": 90, "跟风": 50 };
    const ladder = ladderMap[s.ladderRole] ?? 50;

    // -- news 15% --
    const posCount = s.newsHeadlines?.filter(h => IS_POS.test(h)).length ?? 0;
    const negCount = s.newsHeadlines?.filter(h => IS_NEG.test(h)).length ?? 0;
    const news = clamp(50 + (posCount - negCount) * 15);

    // -- seat 10% --
    let seat = 50;
    if (s.seatPremiumHigh) seat = 90;
    if (s.inPopularityTop10) seat = 20; // 反向指标

    const total = Math.round(W_FUND * fund + W_LIQUIDITY * liquidity + W_LADDER * ladder + W_NEWS * news + W_SEAT * seat);

    const finalTotal = clamp(total);
    results.push({
      code: s.code, name: s.name, price: s.price, pct: s.pct,
      total: finalTotal,
      factors: {
        fund: Math.round(fund), liquidity: Math.round(liquidity),
        ladder: Math.round(ladder), news: Math.round(news), seat: Math.round(seat),
      },
      vetoed: false, vetoReasons: [],
      newsSource: "规则版", invalidation: "",
      tier: finalTotal >= 70 ? "A" : finalTotal >= 55 ? "B" : "C",
    });
  }

  results.sort((a, b) => {
    if (a.vetoed !== b.vetoed) return a.vetoed ? 1 : -1;
    return b.total - a.total;
  });
  return results;
}

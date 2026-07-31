// ETF 评分：三维权重 fundTrend(40)/boardLink(35)/macro(25)
// 纯函数，不碰 DOM/localStorage/网络

// ============== 权重（可调） ==============
const W_FUND_TREND = 0.40;
const W_BOARD_LINK = 0.35;
const W_MACRO = 0.25;

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

// ============== ETF 池配置（可编辑） ==============
export interface ETFSpec {
  code: string;
  name: string;
  boardKeywords: string[];
  macroType: "gold" | "oil" | "copper" | "usd" | null;
  macroDir: 1 | -1;
}

export const ETF_POOL: ETFSpec[] = [
  { code: "510300", name: "沪深300ETF", boardKeywords: [], macroType: null, macroDir: 1 },
  { code: "510500", name: "中证500ETF", boardKeywords: [], macroType: null, macroDir: 1 },
  { code: "588000", name: "科创50ETF", boardKeywords: ["科技", "半导体"], macroType: null, macroDir: 1 },
  { code: "159915", name: "创业板ETF", boardKeywords: ["新能源", "医药"], macroType: null, macroDir: 1 },
  { code: "512100", name: "中证1000ETF", boardKeywords: [], macroType: null, macroDir: 1 },
  { code: "518880", name: "黄金ETF", boardKeywords: ["黄金", "贵金属"], macroType: "gold", macroDir: 1 },
  { code: "512480", name: "半导体ETF", boardKeywords: ["半导体", "芯片"], macroType: null, macroDir: 1 },
  { code: "159995", name: "芯片ETF", boardKeywords: ["芯片", "半导体"], macroType: null, macroDir: 1 },
  { code: "512660", name: "军工ETF", boardKeywords: ["军工", "国防"], macroType: null, macroDir: 1 },
  { code: "512880", name: "证券ETF", boardKeywords: ["证券", "券商"], macroType: null, macroDir: 1 },
  { code: "512800", name: "银行ETF", boardKeywords: ["银行"], macroType: null, macroDir: 1 },
  { code: "510880", name: "红利ETF", boardKeywords: [], macroType: null, macroDir: 1 },
];

// ============== 输入类型 ==============
export interface ETFQuote {
  code: string;
  mainNet5d: number;
  valid: boolean;
}

export interface ETFScoreResult {
  code: string;
  name: string;
  total: number;
  factors: { fundTrend: number; boardLink: number; macro: number };
  tier: "A" | "B" | "C";
}

export function computeETFScores(
  etfQuotes: Map<string, ETFQuote>,
  themeScores: Map<string, number>,
  commodityPcts: Record<string, number>,
): ETFScoreResult[] {
  const results: ETFScoreResult[] = [];

  for (const spec of ETF_POOL) {
    const quote = etfQuotes.get(spec.code);
    // 无行情数据时跳过（fetchStockOne验证失败的）
    if (!quote || !quote.valid) continue;

    // -- fundTrend 40%: f164 真实5日净额 --
    const fundTrend = clamp(50 + quote.mainNet5d / 1e8);

    // -- boardLink 35% --
    let boardLink = 50;
    if (spec.boardKeywords.length > 0) {
      let maxScore = 0;
      for (const kw of spec.boardKeywords) {
        for (const [name, score] of themeScores) {
          if (name.includes(kw)) maxScore = Math.max(maxScore, score);
        }
      }
      if (maxScore > 0) boardLink = maxScore;
    }

    // -- macro 25% --
    let macro = 50;
    if (spec.macroType && commodityPcts[spec.macroType] != null) {
      macro = clamp(50 + commodityPcts[spec.macroType] * 15 * spec.macroDir);
    }

    const total = Math.round(W_FUND_TREND * fundTrend + W_BOARD_LINK * boardLink + W_MACRO * macro);
    const finalTotal = clamp(total);

    results.push({
      code: spec.code,
      name: spec.name,
      total: finalTotal,
      factors: { fundTrend: Math.round(fundTrend), boardLink: Math.round(boardLink), macro: Math.round(macro) },
      tier: finalTotal >= 70 ? "A" : finalTotal >= 55 ? "B" : "C",
    });
  }

  results.sort((a, b) => b.total - a.total);
  return results;
}

// ETF 评分（v9.16 重构）：五维权重 fundTrend(30)/boardLink(25)/styleFit(20)/mainlineLink(15)/macro(10)
// 打破重建：加入市场风格感知 + 主线直出映射
// v9.22-fix：新增 pctBoost(20) ETF 自身今日涨跌幅维度——跌的 ETF 不该被推为主推
//   重新分配权重：fundTrend 20 / pctBoost 20 / boardLink 20 / styleFit 15 / mainline 15 / macro 10 = 100
// 修复 v9.15 的三个 bug：
//   ① 红利 ETF boardKeywords 为空 → 永远中性分（已补关键词）
//   ② 无风格感知 → 进攻日推红利（已加 styleFit 维度）
//   ③ ETF_POOL 缺主线品种（已扩充：AI/计算机/算力/通信/机器人等）
// 纯函数，不碰 DOM/localStorage/网络

// ============== 权重（可调，v9.22 重新分配：加 pctBoost） ==============
const W_FUND_TREND = 0.20;   // 5日主力净额（v9.22: 30→20）
const W_PCT_BOOST  = 0.20;   // ETF 自身今日涨跌幅（v9.22 新增：跌的 ETF 降权）
const W_BOARD_LINK = 0.20;   // 与主线板块联动（v9.22: 25→20）
const W_STYLE_FIT = 0.15;    // 市场风格适配（v9.22: 20→15）
const W_MAINLINE = 0.15;     // 主线直出匹配（不变）
const W_MACRO = 0.10;        // 商品/宏观（不变）

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

// ============== ETF 池配置（可编辑，v9.16 扩充） ==============
export interface ETFSpec {
  code: string;
  name: string;
  boardKeywords: string[];
  macroType: "gold" | "oil" | "copper" | "usd" | null;
  macroDir: 1 | -1;
  /** 风格标签：进攻日加分 / 防守日加分（覆盖 getStyleFit 的默认） */
  styleTilt?: "growth" | "value" | "defensive" | "neutral";
}

export const ETF_POOL: ETFSpec[] = [
  // 宽基
  { code: "510300", name: "沪深300ETF", boardKeywords: [], macroType: null, macroDir: 1, styleTilt: "neutral" },
  { code: "510500", name: "中证500ETF", boardKeywords: [], macroType: null, macroDir: 1, styleTilt: "neutral" },
  { code: "588000", name: "科创50ETF", boardKeywords: ["科创", "半导体", "芯片", "AI", "算力"], macroType: null, macroDir: 1, styleTilt: "growth" },
  { code: "159915", name: "创业板ETF", boardKeywords: ["创业", "新能源", "医药", "AI"], macroType: null, macroDir: 1, styleTilt: "growth" },
  { code: "512100", name: "中证1000ETF", boardKeywords: ["小盘", "题材"], macroType: null, macroDir: 1, styleTilt: "growth" },
  // 科技成长（v9.16 扩充）
  { code: "512480", name: "半导体ETF", boardKeywords: ["半导体", "芯片", "集成电路"], macroType: null, macroDir: 1, styleTilt: "growth" },
  { code: "159995", name: "芯片ETF", boardKeywords: ["芯片", "半导体"], macroType: null, macroDir: 1, styleTilt: "growth" },
  { code: "515050", name: "5G通信ETF", boardKeywords: ["通信", "5G", "光模块", "CPO", "算力"], macroType: null, macroDir: 1, styleTilt: "growth" },
  { code: "159819", name: "人工智能ETF", boardKeywords: ["AI", "人工智能", "大模型", "机器人"], macroType: null, macroDir: 1, styleTilt: "growth" },
  { code: "515230", name: "软件ETF", boardKeywords: ["软件", "计算机", "国产软件", "信创"], macroType: null, macroDir: 1, styleTilt: "growth" },
  { code: "159801", name: "半导体芯片ETF", boardKeywords: ["芯片", "半导体", "集成电路"], macroType: null, macroDir: 1, styleTilt: "growth" },
  { code: "516010", name: "游戏动漫ETF", boardKeywords: ["游戏", "传媒", "动漫", "AI应用"], macroType: null, macroDir: 1, styleTilt: "growth" },
  { code: "159825", name: "新能源车ETF", boardKeywords: ["新能源车", "锂电", "汽车"], macroType: null, macroDir: 1, styleTilt: "growth" },
  // v9.17 扩充：补全用户反馈的主线 ETF
  { code: "159739", name: "云计算ETF", boardKeywords: ["云计算", "云", "IDC", "算力", "服务器", "光模块", "CPO"], macroType: null, macroDir: 1, styleTilt: "growth" },
  { code: "159725", name: "线上消费ETF", boardKeywords: ["线上消费", "电商", "网购", "新零售", "消费互联网", "短视频", "直播带货"], macroType: null, macroDir: 1, styleTilt: "growth" },
  { code: "159899", name: "软件ETF(创业板)", boardKeywords: ["软件", "信创", "国产软件", "AI应用", "互联网", "计算机"], macroType: null, macroDir: 1, styleTilt: "growth" },
  { code: "517050", name: "互联网ETF", boardKeywords: ["互联网", "AI应用", "传媒", "短视频", "游戏"], macroType: null, macroDir: 1, styleTilt: "growth" },
  { code: "562010", name: "游戏ETF", boardKeywords: ["游戏", "AI应用", "传媒", "动漫", "短视频"], macroType: null, macroDir: 1, styleTilt: "growth" },
  { code: "159996", name: "家电ETF", boardKeywords: ["家电", "白色家电", "智能家居"], macroType: null, macroDir: 1, styleTilt: "neutral" },
  { code: "512120", name: "化工ETF", boardKeywords: ["化工", "化学", "化纤", "锂电材料", "磷化工"], macroType: null, macroDir: 1, styleTilt: "neutral" },
  { code: "159870", name: "化工ETF(新材料)", boardKeywords: ["新材料", "化工", "锂电材料", "光伏材料"], macroType: null, macroDir: 1, styleTilt: "growth" },
  { code: "162412", name: "医疗ETF", boardKeywords: ["医疗", "创新药", "医药", "器械"], macroType: null, macroDir: 1, styleTilt: "defensive" },
  // 军工/周期
  { code: "512660", name: "军工ETF", boardKeywords: ["军工", "国防", "航空"], macroType: null, macroDir: 1, styleTilt: "neutral" },
  { code: "512880", name: "证券ETF", boardKeywords: ["证券", "券商", "非银"], macroType: null, macroDir: 1, styleTilt: "neutral" },
  // 防守/价值（v9.16 补关键词修复）
  { code: "512800", name: "银行ETF", boardKeywords: ["银行"], macroType: null, macroDir: 1, styleTilt: "defensive" },
  { code: "510880", name: "红利ETF", boardKeywords: ["红利", "股息", "高股息", "煤炭"], macroType: null, macroDir: 1, styleTilt: "defensive" },
  { code: "512010", name: "医药ETF", boardKeywords: ["医药", "医疗", "创新药"], macroType: null, macroDir: 1, styleTilt: "defensive" },
  // 商品/避险
  { code: "518880", name: "黄金ETF", boardKeywords: ["黄金", "贵金属"], macroType: "gold", macroDir: 1, styleTilt: "defensive" },
];

// ============== 输入类型 ==============
export interface ETFQuote {
  code: string;
  mainNet5d: number;
  /** ETF 自身今日涨跌幅 %（v9.22-fix：跌的 ETF 不该被推为主推） */
  pct: number;
  valid: boolean;
}

export interface ETFScoreResult {
  code: string;
  name: string;
  total: number;
  factors: { fundTrend: number; pctBoost: number; boardLink: number; styleFit: number; mainlineLink: number; macro: number };
  tier: "A" | "B" | "C";
  /** 是否主线直出匹配（来自涨停潮主线） */
  fromMainline: boolean;
  matchedMainline?: string;
  /** v9.22-fix：ETF 自身今日涨跌幅 %（用于 UI 显示 + 排序降权） */
  pct: number;
}

/** 风格信息（来自 mainline.detectMarketStyle） */
export interface StyleInput {
  style: "attack" | "rotation" | "defense";
  riskAppetite: number;
}

export function computeETFScores(
  etfQuotes: Map<string, ETFQuote>,
  themeScores: Map<string, number>,
  commodityPcts: Record<string, number>,
  style?: StyleInput,
  mainlines?: Array<{ board: string }>,
): ETFScoreResult[] {
  const results: ETFScoreResult[] = [];

  for (const spec of ETF_POOL) {
    const quote = etfQuotes.get(spec.code);
    if (!quote || !quote.valid) continue;

    // -- fundTrend 20%: f164 真实5日净额 --
    const fundTrend = clamp(50 + quote.mainNet5d / 1e8);

    // -- v9.22-fix：pctBoost 20% ETF 自身今日涨跌幅（跌的 ETF 不该被推为主推） --
    // 涨 ≥1% = +30 分，涨 0~1% = +10~30 分
    // 跌 0~1% = -10~-30 分，跌 ≥1% = -40 分 + 直接降级
    let pctBoost = 50 + quote.pct * 25;
    if (quote.pct < -1.0) pctBoost -= 20;  // 大跌加重惩罚
    pctBoost = clamp(pctBoost, 0, 100);

    // -- boardLink 20%: 板块联动（主线板块得分高 → ETF 高）--
    let boardLink = 50;
    if (spec.boardKeywords.length > 0) {
      let maxScore = 0;
      for (const kw of spec.boardKeywords) {
        for (const [name, score] of themeScores) {
          if (name.includes(kw) || kw.includes(name) || name.includes(kw.slice(0, 2))) {
            maxScore = Math.max(maxScore, score);
          }
        }
      }
      if (maxScore > 0) boardLink = maxScore;
    }

    // -- styleFit 20%: 风格适配（核心修复）--
    // 进攻日：growth 加分 / defensive 减分；防守日相反
    let styleFit = 50;
    if (style) {
      const tilt = spec.styleTilt ?? "neutral";
      const risk = style.riskAppetite;  // 0-100
      if (style.style === "attack") {
        if (tilt === "growth") styleFit = clamp(50 + (risk - 50) * 0.4 + 20);  // 进攻日成长加分
        else if (tilt === "defensive") styleFit = clamp(50 - 25);              // 防守品种减分
        else styleFit = 50;
      } else if (style.style === "defense") {
        if (tilt === "defensive") styleFit = clamp(50 + (50 - risk) * 0.4 + 20); // 防守日避险加分
        else if (tilt === "growth") styleFit = clamp(50 - 25);
        else styleFit = 50;
      } else {
        // 轮动日：小幅偏好成长
        if (tilt === "growth") styleFit = 55;
        else styleFit = 50;
      }
    }

    // -- mainlineLink 15%: 主线直出匹配 --
    let mainlineLink = 50;
    let fromMainline = false;
    let matchedMainline: string | undefined;
    if (mainlines && mainlines.length > 0 && spec.boardKeywords.length > 0) {
      for (const ml of mainlines) {
        for (const kw of spec.boardKeywords) {
          if (ml.board.includes(kw) || kw.includes(ml.board) || ml.board.includes(kw.slice(0, 2))) {
            mainlineLink = 90;
            fromMainline = true;
            matchedMainline = ml.board;
            break;
          }
        }
        if (fromMainline) break;
      }
    }

    // -- macro 10% --
    let macro = 50;
    if (spec.macroType && commodityPcts[spec.macroType] != null) {
      macro = clamp(50 + commodityPcts[spec.macroType] * 15 * spec.macroDir);
    }

    const total = Math.round(
      W_FUND_TREND * fundTrend +
      W_PCT_BOOST * pctBoost +
      W_BOARD_LINK * boardLink +
      W_STYLE_FIT * styleFit +
      W_MAINLINE * mainlineLink +
      W_MACRO * macro,
    );
    const finalTotal = clamp(total);

    results.push({
      code: spec.code,
      name: spec.name,
      total: finalTotal,
      factors: {
        fundTrend: Math.round(fundTrend),
        pctBoost: Math.round(pctBoost),
        boardLink: Math.round(boardLink),
        styleFit: Math.round(styleFit),
        mainlineLink: Math.round(mainlineLink),
        macro: Math.round(macro),
      },
      tier: finalTotal >= 70 ? "A" : finalTotal >= 55 ? "B" : "C",
      fromMainline,
      matchedMainline,
      pct: quote.pct,  // v9.22-fix: 暴露 pct 用于 UI 显示
    });
  }

  // 排序：主线直出优先 → 总分降序
  // v9.22-fix：跌的 ETF 强制降级为 C，避免"主线直出 90 分"盖过跌幅信号
  for (const r of results) {
    if (r.pct < -0.3) {
      r.tier = "C";
      r.total = Math.min(r.total, 55);
    }
  }
  results.sort((a, b) => Number(b.fromMainline) - Number(a.fromMainline) || b.total - a.total);
  return results;
}

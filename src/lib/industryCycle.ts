// ============================================================
// v9.140.0（阶段三·景气度深化 #12）：景气度评分卡 —— 价格/业绩/政策/资金四维
// 定位：产业链景气度重仓投资人的"选行业"层。与波段方向榜（3天-1个月）互补：
//   方向榜看"现在能不能上车"，景气卡看"这个行业的周期位置与验证节奏"。
// 四维（纯函数，可单测）：
//   ① 价格分（35%）：板块指数 60 日周期位置（站上 MA60 / MA60 斜率 / 60 日涨幅 / 近端动量）
//   ② 资金分（30%）：行业主力资金 10/20/60 日方向（fund_streak 历史序列聚合）
//   ③ 业绩分（20%）：财报披露窗口（景气验证点临近度 —— 披露期/临期 = 信息密集期）
//   ④ 政策分（15%）：近 7 日政策/催化新闻命中（行业关键词 + 新鲜度）
// 输出：景气总分 0-100 + 四维分 + 景气阶段（景气上行/景气高位/景气下行/景气底部/数据不足）+ 依据
// 数据输入与波段方向榜同源（板块日K + fund_streak 序列 + 快讯/政策 + earningsCalendar）
// ============================================================
import type { KlineBar } from "./swingStage";
import type { EarningsWindow } from "./earningsCalendar";

export interface IndustryCycleInput {
  code: string;               // BKxxxx
  name: string;               // 行业板块名
  /** 板块指数日K（升序；60 根以上更佳，价格维度用） */
  klines: KlineBar[];
  /** 近 N 日主力资金净额序列（元，升序=旧→新；可缺省） */
  fundSeq?: number[];
  /** 财报披露窗口（缺省时按当前日期自动生成） */
  earningsWindows?: EarningsWindow[];
  /** 近 N 日政策/催化新闻（标题匹配行业关键词） */
  news?: Array<{ title: string; ts?: number | string }>;
  /** 今日（YYYY-MM-DD，测试注入用） */
  today?: string;
}

export interface IndustryCycleScore {
  code: string;
  name: string;
  price: number;      // 0-100
  fund: number;       // 0-100
  earnings: number;   // 0-100
  policy: number;     // 0-100
  total: number;      // 加权总分
  stage: "景气上行" | "景气高位" | "景气下行" | "景气底部" | "数据不足";
  reasons: string[];
}

/** 板块名 → 政策/催化关键词（缺省用板块名本身；命中=标题含任一词） */
const DEFAULT_KEYWORDS: Record<string, string[]> = {
  "有色金属": ["铜", "铝", "锂", "稀土", "有色", "涨价", "价格"],
  "工业金属": ["铜", "铝", "锌", "锡", "镍", "金属", "涨价"],
  "能源金属": ["锂", "钴", "镍", "碳酸锂", "锂矿", "涨价"],
  "贵金属": ["黄金", "白银", "金价", "银价", "避险"],
  "煤炭": ["煤炭", "煤价", "动力煤", "焦煤", "煤企"],
  "石油": ["原油", "油价", "石油", "OPEC", "减产"],
  "钢铁": ["钢铁", "钢价", "螺纹钢", "粗钢", "铁矿"],
  "化学原料": ["化工", "纯碱", "MDI", "钛白粉", "涨价"],
  "化学制品": ["化工", "农药", "化肥", "钛白粉", "价格"],
  "光伏设备": ["光伏", "硅料", "硅片", "组件", "装机", "多晶硅"],
  "电池": ["电池", "锂电", "储能", "宁德", "装机量"],
  "汽车整车": ["汽车", "新能源车", "销量", "车企", "价格战"],
  "汽车零部件": ["汽车", "零部件", "订单", "配套"],
  "半导体": ["半导体", "芯片", "晶圆", "光刻", "国产替代", "封测"],
  "消费电子": ["消费电子", "手机", "苹果", "折叠屏", "AI硬件"],
  "通信设备": ["通信", "5G", "光模块", "算力", "数据中心"],
  "电网设备": ["电网", "特高压", "变压器", "电力投资", "配网"],
  "电力": ["电力", "电价", "绿电", "煤价", "发电量"],
  "风电设备": ["风电", "风机", "海上风电", "装机"],
  "农牧饲渔": ["猪肉", "猪价", "生猪", "鸡", "饲料", "粮食"],
  "食品饮料": ["食品", "饮料", "白酒", "乳业", "调味品"],
  "家电": ["家电", "空调", "以旧换新", "出口"],
  "医药": ["医药", "集采", "创新药", "医保", "药品"],
  "银行": ["银行", "息差", "存款", "贷款", "LPR"],
  "房地产": ["房地产", "楼市", "房价", "土拍", "房贷"],
  "白酒": ["白酒", "茅台", "五粮液", "提价", "动销"],
  "军工": ["军工", "军贸", "订单", "装备"],
  "船舶制造": ["船舶", "造船", "新船", "运价"],
  "航运港口": ["航运", "运价", "集运", "BDI", "港口"],
  "券商": ["券商", "成交额", "两融", "并购"],
  "软件": ["软件", "信创", "AI", "大模型", "数字经济"],
};

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---------- ① 价格分（60 日周期位置） ----------
export function scorePrice(klines: KlineBar[]): { score: number; pct60d: number | null; aboveMa60: boolean; ma60Up: boolean; signals: string[] } {
  const signals: string[] = [];
  if (!klines || klines.length < 21) return { score: 50, pct60d: null, aboveMa60: false, ma60Up: false, signals: ["板块K线不足（<21 根）"] };
  const closes = klines.map(k => k.close);
  const last = closes[closes.length - 1];
  const win = Math.min(60, closes.length);
  const p0 = closes[closes.length - 1 - win];
  const pct60d = p0 > 0 ? (last - p0) / p0 * 100 : null;
  const ma20 = closes.slice(-20).reduce((s, v) => s + v, 0) / 20;
  const ma60Arr = closes.slice(-60);
  const ma60 = ma60Arr.length >= 60 ? ma60Arr.reduce((s, v) => s + v, 0) / 60 : ma20;
  const ma60PrevArr = closes.slice(-61, -1);
  const ma60Prev = ma60PrevArr.length >= 60 ? ma60PrevArr.reduce((s, v) => s + v, 0) / 60 : ma60;
  const aboveMa60 = last > ma60;
  const ma60Up = ma60 > ma60Prev;
  // 近端动量：近 5 日 vs 前 5 日
  const mom5 = closes.length >= 10 ? closes.slice(-5).reduce((s, v) => s + v, 0) / 5 - closes.slice(-10, -5).reduce((s, v) => s + v, 0) / 5 : 0;
  const momPct = ma20 > 0 ? mom5 / ma20 * 100 : 0;

  let score = 50;
  if (aboveMa60) score += 15; else score -= 15;
  if (ma60Up) score += 10; else score -= 10;
  if (pct60d != null) {
    if (pct60d > 15) score += 15;
    else if (pct60d > 5) score += 8;
    else if (pct60d < -15) score -= 15;
    else if (pct60d < -5) score -= 8;
  }
  if (momPct > 2) score += 5;
  else if (momPct < -2) score -= 5;
  // 高位风险警示：60 日涨幅巨大且跌破 MA20 → 阶段性见顶信号
  if (pct60d != null && pct60d > 30 && last < ma20) { score -= 10; signals.push("60日大涨后跌破MA20（高位风险）"); }
  signals.push(aboveMa60 ? "指数站上 MA60（周期中位上方）" : "指数位于 MA60 下方");
  signals.push(ma60Up ? "MA60 向上（长周期走强）" : "MA60 走平/向下");
  if (pct60d != null) signals.push(`60日涨幅 ${pct60d > 0 ? "+" : ""}${pct60d.toFixed(1)}%`);
  return { score: clamp(score), pct60d, aboveMa60, ma60Up, signals };
}

// ---------- ② 资金分（10/20/60 日方向） ----------
export function scoreFund(fundSeq?: number[]): { score: number; sum10: number | null; sum20: number | null; sum60: number | null; signals: string[] } {
  const signals: string[] = [];
  if (!fundSeq || fundSeq.length === 0) return { score: 50, sum10: null, sum20: null, sum60: null, signals: ["资金序列缺失（中性）"] };
  const sum = (n: number) => { const a = fundSeq.slice(-n); return a.length >= 2 ? a.reduce((s, v) => s + v, 0) : null; };
  const sum10 = sum(10), sum20 = sum(20), sum60 = sum(60);
  let score = 50;
  if (sum20 != null && sum60 != null) {
    if (sum20 > 0 && sum60 > 0) { score = (sum10 ?? 0) > 0 ? 85 : 65; }
    else if (sum20 > 0) { score = (sum10 ?? 0) > 0 ? 70 : 55; }
    else if (sum20 < 0 && sum60 < 0) { score = (sum10 ?? 0) > 0 ? 40 : 25; }
    else if (sum20 < 0) { score = (sum10 ?? 0) > 0 ? 45 : 35; }
  } else if (sum20 != null) {
    score = sum20 > 0 ? ((sum10 ?? 0) > 0 ? 75 : 60) : ((sum10 ?? 0) > 0 ? 45 : 30);
  }
  const yi = (v: number | null) => v == null ? null : Math.round(v / 1e8 * 10) / 10;
  if (sum10 != null) signals.push(`近10日主力 ${yi(sum10) ?? "?"}亿`);
  if (sum20 != null) signals.push(`近20日主力 ${yi(sum20) ?? "?"}亿`);
  if (sum60 != null) signals.push(`近60日主力 ${yi(sum60) ?? "?"}亿`);
  if (score >= 70) signals.push("资金持续净流入（周期资金面强）");
  else if (score <= 35) signals.push("资金持续净流出（周期资金面弱）");
  return { score: clamp(score), sum10, sum20, sum60, signals };
}

// ---------- ③ 业绩分（财报验证窗口临近度） ----------
export function scoreEarnings(windows: EarningsWindow[]): { score: number; signals: string[] } {
  const signals: string[] = [];
  if (!windows || windows.length === 0) return { score: 50, signals: ["财报窗口数据缺失（中性）"] };
  const active = windows.find(w => w.active);
  const upcoming = windows.filter(w => !w.active && w.daysToDeadline >= 0).sort((a, b) => a.daysToDeadline - b.daysToDeadline);
  let score = 50;
  if (active) {
    // 披露期内：景气验证信息密集期（中报/年报权重高于预告）
    const isFormal = active.name === "年报" || active.name === "中报" || active.name === "一季报" || active.name === "三季报";
    score += isFormal ? 25 : 18;
    signals.push(`正处于${active.name}披露期（截止 ${active.deadline}）`);
    if (active.daysToDeadline <= 7) { score += 5; signals.push("临近披露截止（验证点密集）"); }
  } else if (upcoming.length > 0) {
    const next = upcoming[0];
    if (next.daysToDeadline <= 30) { score += 12; signals.push(`${next.daysToDeadline} 天后进入${next.name}窗口`); }
    else { score += 5; signals.push(`${next.name}窗口 ${next.daysToDeadline} 天后（${next.deadline} 截止）`); }
  }
  return { score: clamp(score), signals };
}

// ---------- ④ 政策分（近 7 日催化新闻命中） ----------
export function scorePolicy(news: Array<{ title: string; ts?: number | string }> | undefined, name: string): { score: number; hits: number; recentHits: number; signals: string[] } {
  const signals: string[] = [];
  if (!news || news.length === 0) return { score: 50, hits: 0, recentHits: 0, signals: ["政策/快讯数据缺失（中性）"] };
  const kws = DEFAULT_KEYWORDS[name] ?? [name];
  // 命中：标题含板块名或关键词
  const hits = news.filter(n => kws.some(k => k.length > 0 && n.title.includes(k)));
  // 近 3 天命中（新鲜度）：ts 为数字时间戳或 "YYYY-MM-DD HH:MM:SS"
  const now = Date.now();
  const recent = hits.filter(n => {
    if (typeof n.ts === "number") return now - n.ts < 3 * 86400000;
    if (typeof n.ts === "string" && /^\d{4}-\d{2}-\d{2}/.test(n.ts)) {
      const d = new Date(n.ts.replace(" ", "T") + (n.ts.length === 10 ? "T00:00:00" : ""));
      return now - d.getTime() < 3 * 86400000;
    }
    return true; // 无时间戳视为新鲜
  });
  let score = 40;
  if (hits.length >= 7) score = 80;
  else if (hits.length >= 4) score = 70;
  else if (hits.length >= 2) score = 60;
  else if (hits.length === 1) score = 50;
  score += Math.min(10, recent.length * 3);
  if (hits.length > 0) {
    signals.push(`近7日催化命中 ${hits.length} 条（近3日 ${recent.length} 条）`);
    signals.push(hits.slice(0, 2).map(h => h.title.slice(0, 24)).join(" / "));
  } else {
    signals.push("近 7 日无政策/催化命中");
  }
  return { score: clamp(score), hits: hits.length, recentHits: recent.length, signals };
}

// ---------- 汇总：景气度评分卡 ----------
export function assessIndustryCycle(input: IndustryCycleInput): IndustryCycleScore {
  const { code, name, klines, fundSeq, news, today } = input;
  const windows = input.earningsWindows ?? [];
  const priceR = scorePrice(klines);
  const fundR = scoreFund(fundSeq);
  const earnR = scoreEarnings(windows);
  const polR = scorePolicy(news, name);
  // 四维加权：价格 35% + 资金 30% + 业绩 20% + 政策 15%
  const total = Math.round(priceR.score * 0.35 + fundR.score * 0.3 + earnR.score * 0.2 + polR.score * 0.15);
  // 数据充足度：K线 <21 且无资金序列 → 数据不足
  const dataPoor = (!klines || klines.length < 21) && (!fundSeq || fundSeq.length === 0);
  let stage: IndustryCycleScore["stage"];
  if (dataPoor) stage = "数据不足";
  else if (total >= 70) stage = "景气上行";
  else if (total >= 55) stage = "景气高位";
  else if (total >= 40) stage = "景气下行";
  else stage = "景气底部";
  const reasons = [
    ...priceR.signals.slice(0, 2),
    ...fundR.signals.slice(0, 2),
    ...earnR.signals.slice(0, 1),
    ...polR.signals.slice(0, 1),
  ].slice(0, 6);
  void today;
  return { code, name, price: priceR.score, fund: fundR.score, earnings: earnR.score, policy: polR.score, total, stage, reasons };
}

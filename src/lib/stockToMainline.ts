// LLM 涨停主线归类（v9.17 核心新增）
// 解决问题：申万行业 hybk 是硬分类（"家居用品""软件开发""互联网传媒"），
//   无法聚出"AI应用""云计算""机器人"等跨行业概念主线。
// 设计：让 Agnes 2.5 把涨停池按"软语义"重新归类到主线维度。
//
// 五条红线：① LLM 只产出文本判断/归类 ② 失败降级回 hybk 硬分类
// ③ payload 只放稳定内容（名+行业+涨幅+连板）
// ④ temperature 0.1、不流式、不开 thinking ⑤ 一次调用归类全涨停池

import { callAI, parseAIJSON, type AIResult } from "./ai";
import type { ZTPoolItem } from "./themeLadder";

// ============== 数据结构 ==============
/** 单只涨停股的主线归类（LLM 输出 + 代码聚合） */
export interface StockToMainline {
  code: string;
  name: string;
  hybk: string;             // 原申万行业
  /** LLM 归类的主线标签（如 "AI应用" / "云计算" / "机器人" / "新能源车"） */
  mainline: string;
  /** 0-100，归类置信度 */
  confidence: number;
}

/** LLM 评估的主线（聚合同主线下的所有票） */
export interface MainlineGroup {
  mainline: string;          // 主线名（LLM 归类）
  ztCount: number;           // 涨停家数
  /** 选龙一龙二龙三（按连板+封板时间+封单资金 排序） */
  leaders: MainlineLeader[];
  height: number;            // 组内最高连板
  mainNet: number;            // 板块主力净流入（由 App.tsx 注入或默认 0）
  mainNet5d: number;
  boardPct: number;            // 板块涨幅
  newsTitles: string[];      // 相关新闻标题
  /** 板块效应评估：LLM 判断"是否真主线"（≥3只涨停 = 真主线；1-2只 = 弱主线/孤峰） */
  isPulse: boolean;
  /** LLM 归因逻辑（≤60字） */
  logic: string;
  /** 风险提示（≤20字） */
  caution: string;
  /** 规则机兜底分（保留 LLM 失败时的依据） */
  score: number;
  /** 来自 LLM（true）/ 降级规则机（false） */
  fromLLM: boolean;
}

export interface MainlineLeader {
  code: string;
  name: string;
  role: "龙一" | "龙二" | "龙三";
  boardCount: number;
  firstBoardTime: string;
  sealFund: number;
  amount: number;
  pct: number;
  reason: string;
  /** v9.17-fix：人气榜排名（1=人气最高），-1=未入榜 */
  popularRank: number;
}

// ============== 入口 ==============
export interface ClassifyResult {
  /** 涨停→主线 映射 */
  stockMap: Map<string, StockToMainline>;
  /** 按主线聚合的组（≥3只=真主线，1-2只=孤峰/弱主线） */
  groups: MainlineGroup[];
  /** 评估总览 */
  overview: {
    totalStocks: number;
    mainlineCount: number;
    trueMainlineCount: number; // LLM 判定的真主线数
    logic: string;             // LLM 给出的整体市场逻辑
  };
  /** LLM 是否调用成功 */
  fromLLM: boolean;
}

export interface ClassifyInput {
  rawPool: ZTPoolItem[];
  /** 板块资金流（按 hybk 名匹配）—— 用于补充 mainNet/boardPct */
  boards: Array<{ name: string; pct: number; mainNet: number; mainNet5d?: number; mainNet5dPct?: number }>;
  /** 新闻标题（用于填充每条主线的 newsTitles） */
  newsItems: Array<{ title: string; stars: number }>;
}

/**
 * 批量归类涨停股到主线（一次 LLM 调用）
 * 失败时降级回 hybk 硬分类（构建 MainlineGroup）
 */
export async function classifyStocksToMainlines(input: ClassifyInput): Promise<ClassifyResult> {
  if (!input.rawPool || input.rawPool.length === 0) {
    return { stockMap: new Map(), groups: [], overview: { totalStocks: 0, mainlineCount: 0, trueMainlineCount: 0, logic: "无涨停数据" }, fromLLM: false };
  }

  // 限 payload 30 只（v9.17-fix：50只+thinking=true 超时降级；改 30只+thinking=false 专用任务槽）
  const pool = input.rawPool.slice(0, 30).map(p => ({
    code: String(p.c ?? ""),
    name: String(p.n ?? ""),
    hybk: String(p.hybk ?? "其他"),
    boardCount: p.lbc ?? 1,
    pct: p.zdp ?? 0,
  })).filter(p => p.code);

  // payload：只放稳定内容
  const result: AIResult = await callAI("mainlineClassify", {
    prompt: `你是A股十年经验的概念主线归类分析师，只输出JSON，不输出任何其他文字或markdown标记。

任务：把以下涨停股按"软语义主线"重新归类（不要按申万行业名），例如：
- 蓝色光标、昆仑万维、易点天下、中文在线 → "AI应用"
- 蓝色光标、宏景科技、浪潮信息、紫光股份 → "AI算力"（如果是算力标的）
- 用友网络、泛微网络、卓易信息、普联软件 → "信创/国产软件"
- 蓝色光标、芒果超媒、视觉中国 → "AI+传媒"
- 中际旭创、新易盛、天孚通信、华工科技 → "光通信/CPO"
- 卧龙电驱、机器人ETF成分股 → "机器人/减速器"
- 中国稀土、北方稀土 → "稀土"
- 寒武纪、海光信息 → "国产芯片"
- 标的不足 2 只的归 "其他"（避免孤峰）

注意：
1. 主线名要"投资者口语化"（如"AI应用"不是"互联网信息服务"）
2. 同一主线的票要确保是"同一概念"（不要把"机器人"和"AI应用"混在一起）
3. 同时评估每条主线的"是否真主线"：涨停家数≥3 = 真主线；1-2只 = 弱主线/孤峰

输入涨停股（代码/名称/申万行业/连板数/涨幅）：
${JSON.stringify(pool)}

输出格式（严格JSON数组）：
{
  "stocks": [
    {"code":"002230","name":"科大讯飞","mainline":"AI应用","confidence":95},
    {"code":"688041","name":"海光信息","mainline":"国产芯片","confidence":90}
  ],
  "groups": [
    {
      "mainline":"AI应用",
      "ztCount":5,
      "isPulse":false,
      "logic":"人工智能法立法加速+大模型超预期，板块效应明确",
      "caution":"注意高位分歧"
    }
  ],
  "overview": {
    "totalStocks":30,
    "mainlineCount":6,
    "trueMainlineCount":3,
    "logic":"今日盘面以AI应用/算力/国产软件为主线，机器人+新能源车辅助"
  }
}`,
  });

  // 降级：LLM 失败 → 用 hybk 硬分类
  if (result.degraded) {
    const fallback = fallbackByHybk(input);
    return fallback;
  }

  return parseClassifyResult(result.text, input);
}

// ============== 容错解析 ==============
function parseClassifyResult(raw: string, input: ClassifyInput): ClassifyResult {
  const parsed = parseAIJSON<{
    stocks?: Array<Record<string, unknown>>;
    groups?: Array<Record<string, unknown>>;
    overview?: Record<string, unknown>;
  }>(raw, ["stocks"]);

  if (!parsed || !Array.isArray(parsed.stocks)) {
    return fallbackByHybk(input);
  }

  // 解析个股归类
  const stockMap = new Map<string, StockToMainline>();
  for (const s of parsed.stocks) {
    const code = String(s.code ?? "");
    if (!code) continue;
    stockMap.set(code, {
      code,
      name: String(s.name ?? ""),
      hybk: String(s.hybk ?? "其他"),
      mainline: String(s.mainline ?? "其他").trim() || "其他",
      confidence: Math.max(0, Math.min(100, Number(s.confidence) || 50)),
    });
  }

  // 解析主线组
  const groups: MainlineGroup[] = [];
  for (const g of parsed.groups ?? []) {
    const mainline = String(g.mainline ?? "").trim();
    if (!mainline) continue;
    const ztCount = Math.max(0, Number(g.ztCount) || 0);
    // 从 stockMap 找该主线下的票
    const stockCodes = [...stockMap.values()].filter(s => s.mainline === mainline).map(s => s.code);
    const leaders = pickLeaders(input.rawPool, stockCodes);
    // 资金从 boards 模糊匹配（hybk 行业名 → boardFlow）
    let mainNet = 0, mainNet5d = 0, boardPct = 0;
    for (const b of input.boards) {
      if (mainline.includes(b.name) || b.name.includes(mainline)) {
        mainNet = b.mainNet; mainNet5d = b.mainNet5d ?? 0; boardPct = b.pct;
        break;
      }
    }
    groups.push({
      mainline,
      ztCount,
      leaders,
      height: leaders.length > 0 ? Math.max(...leaders.map(l => l.boardCount)) : 0,
      mainNet, mainNet5d, boardPct,
      newsTitles: input.newsItems.filter(n => n.title.includes(mainline) || mainline.includes(n.title.split(" ").slice(-1)[0] || "")).slice(0, 6).map(n => n.title),
      isPulse: Boolean(g.isPulse),
      logic: String(g.logic ?? "").slice(0, 60),
      caution: String(g.caution ?? "").slice(0, 20),
      score: ztCount >= 3 ? 80 : ztCount >= 2 ? 60 : 30,
      fromLLM: true,
    });
  }

  return {
    stockMap,
    groups: groups.sort((a, b) => b.ztCount - a.ztCount || b.height - a.height),
    overview: {
      totalStocks: stockMap.size,
      mainlineCount: groups.length,
      trueMainlineCount: groups.filter(g => !g.isPulse).length,
      logic: String(parsed.overview?.logic ?? "").slice(0, 200),
    },
    fromLLM: true,
  };
}

// ============== 降级：hybk 硬分类（LLM 失败时） ==============
function fallbackByHybk(input: ClassifyInput): ClassifyResult {
  const stockMap = new Map<string, StockToMainline>();
  for (const p of input.rawPool.slice(0, 50)) {
    const code = String(p.c ?? "");
    if (!code) continue;
    stockMap.set(code, {
      code, name: String(p.n ?? ""),
      hybk: String(p.hybk ?? "其他"),
      mainline: String(p.hybk ?? "其他") || "其他",  // 直接用 hybk 作为主线名
      confidence: 30,  // 降级置信度低
    });
  }
  // 按 hybk 分组
  const hybkGroups = new Map<string, ZTPoolItem[]>();
  for (const p of input.rawPool) {
    const key = String(p.hybk ?? "其他");
    const arr = hybkGroups.get(key) ?? [];
    arr.push(p);
    hybkGroups.set(key, arr);
  }
  const groups: MainlineGroup[] = [];
  for (const [hybk, items] of hybkGroups) {
    if (items.length < 2) continue;  // 同样要求≥2只，避免孤峰
    const stockCodes = items.map(p => String(p.c));
    const leaders = pickLeaders(input.rawPool, stockCodes);
    let mainNet = 0, mainNet5d = 0, boardPct = 0;
    for (const b of input.boards) {
      if (hybk === b.name || b.name.includes(hybk)) {
        mainNet = b.mainNet; mainNet5d = b.mainNet5d ?? 0; boardPct = b.pct;
        break;
      }
    }
    groups.push({
      mainline: hybk,
      ztCount: items.length,
      leaders,
      height: Math.max(...items.map(i => i.lbc ?? 1)),
      mainNet, mainNet5d, boardPct,
      newsTitles: input.newsItems.filter(n => n.title.includes(hybk)).slice(0, 3).map(n => n.title),
      isPulse: items.length < 3,  // <3只=脉冲/孤峰
      logic: `降级模式（LLM失败）：hybk分组合计${items.length}只`,
      caution: items.length < 3 ? "涨停数<3，板块效应弱" : "",
      score: items.length >= 3 ? 60 : items.length === 2 ? 40 : 0,
      fromLLM: false,
    });
  }
  return {
    stockMap,
    groups: groups.sort((a, b) => b.ztCount - a.ztCount),
    overview: {
      totalStocks: stockMap.size,
      mainlineCount: groups.length,
      trueMainlineCount: groups.filter(g => !g.isPulse).length,
      logic: "降级模式（LLM失败）：按申万行业 hybk 分组",
    },
    fromLLM: false,
  };
}

// ============== 工具：龙一龙二龙三 ==============
function pickLeaders(rawPool: ZTPoolItem[], stockCodes: string[]): MainlineLeader[] {
  const set = new Set(stockCodes);
  const items = rawPool.filter(p => set.has(String(p.c)));
  if (items.length === 0) return [];
  // 按 连板数降序 + 封板时间升序 + 封单资金降序
  const sorted = [...items].sort((a, b) => {
    const lab = (b.lbc ?? 1) - (a.lbc ?? 1);
    if (lab !== 0) return lab;
    const fbtA = a.fbt ?? 999999;
    const fbtB = b.fbt ?? 999999;
    if (fbtA !== fbtB) return fbtA - fbtB;
    return (b.fund ?? 0) - (a.fund ?? 0);
  });
  const leaders: MainlineLeader[] = [];
  const top = sorted[0];
  leaders.push({
    code: String(top.c), name: String(top.n),
    role: "龙一",
    boardCount: top.lbc ?? 1,
    firstBoardTime: fmtFbt(top.fbt ?? 0),
    sealFund: top.fund ?? 0,
    amount: top.amount ?? 0,
    pct: top.zdp ?? 0,
    reason: `${top.lbc ?? 1}板·首封${fmtFbt(top.fbt ?? 0)}·封单${((top.fund ?? 0) / 1e8).toFixed(1)}亿`,
    popularRank: -1,
  });
  // 龙二：同板次封 或 次高板
  const rest = sorted.filter(s => String(s.c) !== String(top.c));
  if (rest.length > 0) {
    const dragon2 = rest[0];
    leaders.push({
      code: String(dragon2.c), name: String(dragon2.n),
      role: "龙二",
      boardCount: dragon2.lbc ?? 1,
      firstBoardTime: fmtFbt(dragon2.fbt ?? 0),
      sealFund: dragon2.fund ?? 0,
      amount: dragon2.amount ?? 0,
      pct: dragon2.zdp ?? 0,
      reason: `${dragon2.lbc ?? 1}板·封单${((dragon2.fund ?? 0) / 1e8).toFixed(1)}亿`,
    popularRank: -1,
    });
  }
  // 龙三：成交额大（中军）
  const rest2 = rest.filter(s => String(s.c) !== (leaders[1]?.code ?? ""));
  if (rest2.length > 0) {
    const sortedByAmount = [...rest2].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    const dragon3 = sortedByAmount[0];
    leaders.push({
      code: String(dragon3.c), name: String(dragon3.n),
      role: "龙三",
      boardCount: dragon3.lbc ?? 1,
      firstBoardTime: fmtFbt(dragon3.fbt ?? 0),
      sealFund: dragon3.fund ?? 0,
      amount: dragon3.amount ?? 0,
      pct: dragon3.zdp ?? 0,
      reason: `成交额${((dragon3.amount ?? 0) / 1e8).toFixed(1)}亿·中军`,
    popularRank: -1,
    });
  }
  return leaders;
}

function fmtFbt(t: number): string {
  const s = String(t).padStart(6, "0");
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
}

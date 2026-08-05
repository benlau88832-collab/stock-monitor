// LLM 涨停主线归类（v9.17 核心新增 + v9.20 概念板块分组）
// 解决问题：申万行业 hybk 是硬分类（"家居用品""软件开发""互联网传媒"），
//   无法聚出"AI应用""云计算""机器人"等跨行业概念主线。
// 设计：让 Agnes 2.5 把涨停池按"软语义"重新归类到主线维度。
//   失败降级：v9.20 改为按"概念板块"分组（不是 hybk 行业），更贴近实际需求。
//
// 五条红线：① LLM 只产出文本判断/归类 ② 失败降级回概念板块（不是行业）
// ③ payload 只放稳定内容（名+行业+涨幅+连板）
// ④ temperature 0.1、不流式、不开 thinking ⑤ 一次调用归类全涨停池

import { callAI, parseAIJSON, type AIResult } from "./ai";
import type { ZTPoolItem } from "./themeLadder";
import { fetchBoardFundFlow, fetchBoardConstituents } from "./api";
import { isRealConceptBoard } from "./boardTaxonomy";
import { fetchStocksBoards } from "./stockBoards";
import { foldConcepts, foldBoardFunds } from "./conceptGroups";

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
  /** v9.23-1：主线强度分（0-100，PRD 6.1 公式），由 App.tsx 注入 */
  strengthScore?: number;
  /** v9.23-1：强度因子明细（UI 证据链） */
  strengthFactors?: { ztRatio: number; height: number; promotion: number; fund: number; turnover: number; catalyst: number };
  /** v9.26 F-12：数据完整度 0~1（缺失字段越多越低） */
  strengthCompleteness?: number;
  /** v9.26 F-12：缺失字段名 */
  strengthMissing?: string[];
  /** v9.26 A.4：快照抓取时间（可回放审计） */
  observedAt?: string;
  /** v9.23-2：主线级离场信号（触发则 true，由 App.tsx 注入） */
  exitSignal?: boolean;
  exitSignalText?: string;
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
  /** v9.32.1（缺口4）：板型 —— 一字板（无换手难上车）/ 缩量板 / 换手板（可上车） */
  boardType?: "一字板" | "缩量板" | "换手板";
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
  // v9.26.15：给 LLM 附加"概念归属"提示（datacenter 折叠后），归类更准
  let conceptHint = new Map<string, string[]>();
  try {
    const hintCodes = input.rawPool.slice(0, 30).map(p => String(p.c ?? "")).filter(Boolean);
    const boardsMap = await fetchStocksBoards(hintCodes);
    for (const [code, sb] of boardsMap) {
      const folded = foldConcepts(sb.themes);
      if (folded.length > 0) conceptHint.set(code, folded);
    }
  } catch { /* 概念提示失败不阻塞 LLM */ }
  const pool = input.rawPool.slice(0, 30).map(p => ({
    code: String(p.c ?? ""),
    name: String(p.n ?? ""),
    hybk: String(p.hybk ?? "其他"),
    boardCount: p.lbc ?? 1,
    pct: p.zdp ?? 0,
    // v9.26.15：概念提示（如 ["通信","AI应用"]）—— LLM 归类依据
    concepts: conceptHint.get(String(p.c ?? "")) ?? [],
  })).filter(p => p.code);

  // payload：只放稳定内容
  const result: AIResult = await callAI("mainlineClassify", {
    prompt: `你是A股十年经验的概念主线归类分析师，只输出JSON，不输出任何其他文字或markdown标记。

任务：把以下涨停股按"软语义主线"重新归类（不要按申万行业名），例如：
- 蓝色光标、昆仑万维、易点天下、中文在线 → "AI应用"
- 中大力德、埃斯顿、绿的谐波、机器人ETF成分股 → "机器人/减速器"
- 卧龙电驱、人形机器人概念股 → "机器人/电机"
- 蓝色光标、宏景科技、浪潮信息、紫光股份 → "AI算力"（如果是算力标的）
- 用友网络、泛微网络、卓易信息、普联软件 → "信创/国产软件"
- 蓝色光标、芒果超媒、视觉中国 → "AI+传媒"
- 中际旭创、新易盛、天孚通信、华工科技 → "光通信/CPO"
- 中国稀土、北方稀土 → "稀土"
- 寒武纪、海光信息 → "国产芯片"
- 标的不足 2 只的归 "其他"（避免孤峰）

⚠️ 强制规则（v9.20-fix，用户反馈）：
1. mainline 必须是"概念主线/题材主线"（如"机器人""AI应用""稀土""光通信CPO""信创""新能源车"等），
   绝不能用申万行业名（绝不能是"通用设备""电气设备""计算机设备""通信设备""机械设备"这种行业分类）！
2. 即使一只涨停股本身归在某个行业（hybk字段），也要看它实际所属的"概念题材"重新归类。
   比如"中大力德"申万行业是"通用设备"，但概念归属是"机器人"——必须归到"机器人"！
3. 主线名要"投资者口语化"（"机器人"不是"其他通用机械""其他专用设备"）。
4. 同一主线的票要确保是"同一概念"（不要把"机器人"和"AI应用"混在一起）。
5. 同时评估每条主线的"是否真主线"：涨停家数≥3 = 真主线（isPulse=false）；1-2只 = 弱主线/孤峰（isPulse=true）。
6. ⚠️（v9.26.15）每条输入含 concepts 字段 = 该股真实概念归属（已折叠为"通信/芯片/AI应用"等大类），
   归类必须优先参考 concepts：比如 concepts=["通信","华为"] 就归"通信"，
   不要只看 hybk 行业名。concepts 为空时再按名称+hybk 判断。

输入涨停股（代码/名称/申万行业/连板数/涨幅/概念归属）：
${JSON.stringify(pool)}

输出格式（严格JSON）：
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

  // 降级：LLM 失败 → 用概念板块硬分类
  if (result.degraded) {
    console.warn("[stockToMainline] LLM 降级（degraded=true）→ fallback 概念板块分组。原因：详见 ai.ts 降级链路");
    const fallback = await fallbackByHybk(input);
    return fallback;
  }

  // v9.26.15：LLM 归类（前30只） + 概念聚合补全（其余涨停）→ 防漏主线
  const llmResult = await parseClassifyResult(result.text, input);
  return await mergeWithConceptFallback(llmResult, input);
}

/** v9.26.15：LLM 归类结果 + 概念聚合合并（LLM 只处理前 30 只，其余涨停用概念补齐防漏主线） */
async function mergeWithConceptFallback(parsedResult: ClassifyResult, input: ClassifyInput): Promise<ClassifyResult> {
  const llmCodes = new Set(parsedResult.stockMap.keys());
  // 找出 LLM 未覆盖的涨停股
  const uncovered = input.rawPool.filter(p => !llmCodes.has(String(p.c ?? "")));
  if (uncovered.length === 0) return parsedResult;

  // 用概念聚合（foldConcepts 折叠 + 一对多展开）补充未覆盖股
  try {
    const uncoveredCodes = uncovered.map(p => String(p.c ?? "")).filter(Boolean);
    const boardsMap = await fetchStocksBoards(uncoveredCodes);
    const uncoveredToGroups = new Map<string, string[]>();
    for (const [code, sb] of boardsMap) {
      const folded = foldConcepts(sb.themes);
      if (folded.length > 0) uncoveredToGroups.set(code, folded);
    }
    // 组计数（含 LLM 已归类的，保证总数一致）
    const groupZtCount = new Map<string, number>();
    for (const s of parsedResult.stockMap.values()) {
      groupZtCount.set(s.mainline, (groupZtCount.get(s.mainline) ?? 0) + 1);
    }
    for (const groups of uncoveredToGroups.values()) {
      for (const g of groups) groupZtCount.set(g, (groupZtCount.get(g) ?? 0) + 1);
    }
    // v9.26.16：折叠 boards（用于资金匹配）
    const foldedBoards = foldBoardFunds(input.boards);

    // 补充 stockMap
    const stockMap = new Map(parsedResult.stockMap);
    for (const p of uncovered) {
      const code = String(p.c ?? "");
      const groups = uncoveredToGroups.get(code);
      const mainline = groups && groups.length > 0
        ? [...groups].sort((a, b) => (groupZtCount.get(b) ?? 0) - (groupZtCount.get(a) ?? 0))[0]
        : String(p.hybk ?? "其他");
      stockMap.set(code, {
        code, name: String(p.n ?? ""),
        hybk: String(p.hybk ?? "其他"),
        mainline,
        confidence: groups && groups.length > 0 ? 60 : 25,
      });
    }

    // 重建 groups：按 mainline 聚合全部（LLM 组 + 概念补充组）
    const grouped = new Map<string, ZTPoolItem[]>();
    for (const p of input.rawPool) {
      const ml = stockMap.get(String(p.c ?? ""))?.mainline ?? "其他";
      const arr = grouped.get(ml) ?? [];
      arr.push(p);
      grouped.set(ml, arr);
    }
    const groups: MainlineGroup[] = [];
    for (const [ml, items] of grouped) {
      if (items.length < 2) continue;
      const stockCodes = items.map(p => String(p.c));
      const leaders = pickLeaders(input.rawPool, stockCodes);
      // 保留 LLM 组的 logic/caution/isPulse（若该主线 LLM 已评估），否则用概念补充
      const llmGroup = parsedResult.groups.find(g => g.mainline === ml);
      // v9.26.16：资金匹配（foldBoardFunds 折叠优先 → LLM 组 → 模糊兜底）
      let mainNet = 0, mainNet5d = 0, boardPct = 0;
      const fb = foldedBoards.get(ml);
      if (fb) { mainNet = fb.mainNet; mainNet5d = fb.mainNet5d ?? 0; boardPct = fb.pct; }
      if (mainNet === 0 && !llmGroup) {
        for (const b of input.boards) {
          if (ml.includes(b.name) || b.name.includes(ml)) {
            mainNet = b.mainNet; mainNet5d = b.mainNet5d ?? 0; boardPct = b.pct;
            break;
          }
        }
      }
      if (mainNet === 0 && llmGroup) {
        mainNet = llmGroup.mainNet; mainNet5d = llmGroup.mainNet5d ?? 0; boardPct = llmGroup.boardPct;
      }
      groups.push({
        mainline: ml,
        ztCount: items.length,
        leaders,
        height: Math.max(...items.map(i => i.lbc ?? 1)),
        mainNet, mainNet5d, boardPct,
        newsTitles: input.newsItems.filter(n => n.title.includes(ml)).slice(0, 3).map(n => n.title),
        isPulse: llmGroup?.isPulse ?? items.length < 3,
        logic: llmGroup?.logic ?? `概念补充（LLM未覆盖，${items.length}只）`,
        caution: llmGroup?.caution ?? (items.length < 3 ? "涨停数<3，板块效应弱" : ""),
        score: llmGroup?.score ?? (items.length >= 3 ? 65 : items.length === 2 ? 45 : 0),
        fromLLM: Boolean(llmGroup?.fromLLM) || false,
      });
    }
    return {
      stockMap,
      groups: groups.sort((a, b) => b.ztCount - a.ztCount || b.height - a.height),
      overview: {
        totalStocks: stockMap.size,
        mainlineCount: groups.length,
        trueMainlineCount: groups.filter(g => !g.isPulse).length,
        logic: parsedResult.overview.logic,
      },
      fromLLM: true,
    };
  } catch (e) {
    console.warn("[stockToMainline] 概念补充失败，用 LLM 结果:", e);
    return parsedResult;
  }
}

// ============== 容错解析 ==============
async function parseClassifyResult(raw: string, input: ClassifyInput): Promise<ClassifyResult> {
  const parsed = parseAIJSON<{
    stocks?: Array<Record<string, unknown>>;
    groups?: Array<Record<string, unknown>>;
    overview?: Record<string, unknown>;
  }>(raw, ["stocks"]);

  if (!parsed || !Array.isArray(parsed.stocks)) {
    console.warn("[stockToMainline] LLM JSON 解析失败（返回格式非预期）→ fallback 概念板块分组");
    console.warn("[stockToMainline] LLM 原始返回前 500 字:", String(raw).slice(0, 500));
    return await fallbackByHybk(input);
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
  const foldedBoards = foldBoardFunds(input.boards); // v9.26.16：折叠 boards（"人工智能"→"AI应用"）
  const groups: MainlineGroup[] = [];
  for (const g of parsed.groups ?? []) {
    const mainline = String(g.mainline ?? "").trim();
    if (!mainline) continue;
    const ztCount = Math.max(0, Number(g.ztCount) || 0);
    // 从 stockMap 找该主线下的票
    const stockCodes = [...stockMap.values()].filter(s => s.mainline === mainline).map(s => s.code);
    const leaders = pickLeaders(input.rawPool, stockCodes);
    // 资金从折叠后的 boards 取（精确匹配大类 key → 不再走模糊包含）
    const fb = foldedBoards.get(mainline);
    let mainNet = fb?.mainNet ?? 0;
    let mainNet5d = fb?.mainNet5d ?? 0;
    let boardPct = fb?.pct ?? 0;
    // 兜底：若折叠后未命中，尝试 boards 原始名模糊包含（兼容行业类主线）
    if (mainNet === 0) {
      for (const b of input.boards) {
        if (mainline.includes(b.name) || b.name.includes(mainline)) {
          mainNet = b.mainNet; mainNet5d = b.mainNet5d ?? 0; boardPct = b.pct;
          break;
        }
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

// ============== 降级：按概念板块分组（v9.20 取代 hybk 分组） ==============
// 解决：用户反馈"中大力德是机器人概念，机器人今天批量涨停，但抓到的是通用设备"
// 策略：v9.21-B 优先用"个股所属概念"（datacenter 接口，同花顺式）→ 失败再用成分股反查 → 再失败 hybk
// v9.21-A：① 成分股反查 15→50 只（涨停股常在成分股 16-30 位，之前被漏）
//         ② 过滤"新股/次新股"等非题材板块分类
//         ③ 多概念归属时按"今日涨停数最多"择优（数据驱动，不按名字长度）
async function fallbackByHybk(input: ClassifyInput): Promise<ClassifyResult> {
  try {
    // v9.26.16：折叠 boards 一次，下面所有分支都用
    const foldedBoards = foldBoardFunds(input.boards);
    // ===== v9.21-B + v9.26.15：优先用"个股所属概念"（datacenter 接口，准确度最高）
    // v9.26.15 方案A 升级：
    //   ① 全量涨停（原 slice(0,50) 截断 → 后 70 只涨停全部丢失 = 通信/算力主线消失的元凶）
    //   ② 词根折叠（概念名 → 用户大类："光模块/CPO/华为"→"通信"）
    //   ③ 一对多展开（一只涨停股的所有折叠概念都参与聚合，不再"择优取1"）
    const ztCodes = input.rawPool.map(p => String(p.c ?? "")).filter(Boolean);
    const boardsMap = await fetchStocksBoards(ztCodes);
    if (boardsMap.size > 0) {
      // 每只股 → 折叠后的概念大类列表（一对多）
      const codeToGroups = new Map<string, string[]>();
      for (const [code, sb] of boardsMap) {
        const folded = foldConcepts(sb.themes);
        if (folded.length > 0) codeToGroups.set(code, folded);
      }
      // 统计每个折叠大类的今日涨停数（用于排序）
      const groupZtCount = new Map<string, number>();
      for (const groups of codeToGroups.values()) {
        for (const g of groups) groupZtCount.set(g, (groupZtCount.get(g) ?? 0) + 1);
      }
      // 给每只涨停股打主标签（其折叠概念中涨停数最多的；无概念 → hybk 兜底）
      const stockMap = new Map<string, StockToMainline>();
      for (const p of input.rawPool) {
        const code = String(p.c ?? "");
        if (!code) continue;
        const groups = codeToGroups.get(code);
        let mainline: string;
        if (groups && groups.length > 0) {
          mainline = [...groups].sort((a, b) =>
            (groupZtCount.get(b) ?? 0) - (groupZtCount.get(a) ?? 0) ||
            a.length - b.length
          )[0];
        } else {
          mainline = String(p.hybk ?? "其他");
        }
        stockMap.set(code, {
          code, name: String(p.n ?? ""),
          hybk: String(p.hybk ?? "其他"),
          mainline,
          confidence: groups && groups.length > 0 ? 60 : 25,
        });
      }
      // 按折叠大类一对多聚合（每只股进所有折叠概念组）
      const groups = new Map<string, ZTPoolItem[]>();
      for (const p of input.rawPool) {
        const code = String(p.c ?? "");
        const gs = codeToGroups.get(code);
        const keys = gs && gs.length > 0 ? gs : [String(p.hybk ?? "其他")];
        for (const k of keys) {
          const arr = groups.get(k) ?? [];
          arr.push(p);
          groups.set(k, arr);
        }
      }
      const result: MainlineGroup[] = [];
      for (const [ml, items] of groups) {
        if (items.length < 2) continue;
        const stockCodes = items.map(p => String(p.c));
        const leaders = pickLeaders(input.rawPool, stockCodes);
        // v9.26.15：资金从 boards 模糊匹配（概念/行业名 → boardFlow）
        // v9.26.16：折叠 boards（"人工智能"→"AI应用"）优先精确匹配
        const fb = foldedBoards.get(ml);
        let mainNet = fb?.mainNet ?? 0;
        let mainNet5d = fb?.mainNet5d ?? 0;
        let boardPct = fb?.pct ?? 0;
        if (mainNet === 0) {
          for (const b of input.boards) {
            if (ml.includes(b.name) || b.name.includes(ml)) {
              mainNet = b.mainNet; mainNet5d = b.mainNet5d ?? 0; boardPct = b.pct;
              break;
            }
          }
        }
        result.push({
          mainline: ml,
          ztCount: items.length,
          leaders,
          height: Math.max(...items.map(i => i.lbc ?? 1)),
          mainNet, mainNet5d, boardPct,
          newsTitles: input.newsItems.filter(n => n.title.includes(ml)).slice(0, 3).map(n => n.title),
          isPulse: items.length < 3,
          logic: `降级模式（LLM失败）：个股概念聚合+词根折叠（${items.length}只）`,
          caution: items.length < 3 ? "涨停数<3，板块效应弱" : "",
          score: items.length >= 3 ? 65 : items.length === 2 ? 45 : 0,
          fromLLM: false,
        });
      }
      return {
        stockMap,
        groups: result.sort((a, b) => b.ztCount - a.ztCount),
        overview: {
          totalStocks: stockMap.size,
          mainlineCount: result.length,
          trueMainlineCount: result.filter(g => !g.isPulse).length,
          logic: "降级模式（LLM失败）：个股概念聚合+词根折叠（datacenter，同花顺式）",
        },
        fromLLM: false,
      };
    }

    // ===== 兜底 A：成分股反查（v9.20 逻辑，增强版） =====
    // 1. 拉今日概念板块（涨幅 + 资金流入 都过滤正向），取前 80 个
    const concepts = await fetchBoardFundFlow("concept", 300);
    // 过滤：非真实题材 + "新股/次新股/最近强势/活跃小盘" 等板块分类（非题材主线）
    const NON_THEME = /新股|次新|最近|强势|活跃|破净|转股|高送转|填权|st|ST|预增|预亏|含权|含H|含B|AH|AB|CDR|B股|H股|百元|低价|微盘|大盘|小盘|中盘|融资|融券|深股通|沪股通|MSCI|富时|标普|QFII|社保|证金|汇金|基金重仓|券商重仓|保险重仓|信托重仓|QFII重仓/;
    const hot = concepts
      .filter(b => isRealConceptBoard(b.name) && !NON_THEME.test(b.name) && b.pct > 0 && (b.mainNet > 0))
      .slice(0, 80);

    // 2. 并行拉每个概念的成分股（v9.21-A：50 只/概念，并发 6 避免限速）
    const stockToConcepts = new Map<string, Set<string>>(); // code → 多个概念名
    const chunks: typeof hot[] = [];
    for (let i = 0; i < hot.length; i += 6) chunks.push(hot.slice(i, i + 6));
    for (const chunk of chunks) {
      await Promise.all(chunk.map(async (c) => {
        try {
          const constituents = await fetchBoardConstituents(c.code, 50);
          for (const s of constituents) {
            if (!stockToConcepts.has(s.code)) stockToConcepts.set(s.code, new Set());
            stockToConcepts.get(s.code)!.add(c.name);
          }
        } catch { /* 单概念失败跳过 */ }
      }));
    }

    // 3. 统计每个概念的今日涨停数（用于多概念择优）
    const conceptZtCount = new Map<string, number>();
    for (const [code, cnames] of stockToConcepts) {
      const isZT = input.rawPool.some(p => String(p.c) === code);
      if (isZT) {
        for (const cn of cnames) {
          conceptZtCount.set(cn, (conceptZtCount.get(cn) ?? 0) + 1);
        }
      }
    }

    // 4. 给涨停股打概念标签（v9.26.17：全量遍历，原 slice(0,50) 截断导致后 70 只涨停漏归）
    const stockMap = new Map<string, StockToMainline>();
    for (const p of input.rawPool) {
      const code = String(p.c ?? "");
      if (!code) continue;
      const cnames = stockToConcepts.get(code);
      let mainline: string;
      if (cnames && cnames.size > 0) {
        // 多概念择优：先按今日涨停数降序，再按名字长度（短的更精确）
        mainline = [...cnames].sort((a, b) =>
          (conceptZtCount.get(b) ?? 0) - (conceptZtCount.get(a) ?? 0) ||
          a.length - b.length
        )[0];
      } else {
        mainline = String(p.hybk ?? "其他"); // 没匹配上 → hybk 兜底
      }
      stockMap.set(code, {
        code, name: String(p.n ?? ""),
        hybk: String(p.hybk ?? "其他"),
        mainline,
        confidence: cnames && cnames.size > 0 ? 55 : 25,
      });
    }

    // 5. 按 mainline 分组
    const groups = new Map<string, ZTPoolItem[]>();
    for (const p of input.rawPool) {
      const ml = stockMap.get(String(p.c ?? ""))?.mainline ?? "其他";
      const arr = groups.get(ml) ?? [];
      arr.push(p);
      groups.set(ml, arr);
    }

    const result: MainlineGroup[] = [];
    for (const [ml, items] of groups) {
      if (items.length < 2) continue; // ≥2 只才算主线
      const stockCodes = items.map(p => String(p.c));
      const leaders = pickLeaders(input.rawPool, stockCodes);
      let mainNet = 0, mainNet5d = 0, boardPct = 0;
      // 优先用概念板块的资金/涨幅
      const matchedConcept = hot.find(c => c.name === ml);
      if (matchedConcept) {
        mainNet = matchedConcept.mainNet;
        mainNet5d = (matchedConcept as any).mainNet5d ?? 0;
        boardPct = matchedConcept.pct;
      }
      result.push({
        mainline: ml,
        ztCount: items.length,
        leaders,
        height: Math.max(...items.map(i => i.lbc ?? 1)),
        mainNet, mainNet5d, boardPct,
        newsTitles: input.newsItems.filter(n => n.title.includes(ml)).slice(0, 3).map(n => n.title),
        isPulse: items.length < 3,
        logic: `降级模式（LLM失败）：按概念板块分组合计${items.length}只`,
        caution: items.length < 3 ? "涨停数<3，板块效应弱" : "",
        score: items.length >= 3 ? 60 : items.length === 2 ? 40 : 0,
        fromLLM: false,
      });
    }

    return {
      stockMap,
      groups: result.sort((a, b) => b.ztCount - a.ztCount),
      overview: {
        totalStocks: stockMap.size,
        mainlineCount: result.length,
        trueMainlineCount: result.filter(g => !g.isPulse).length,
        logic: "降级模式（LLM失败）：按概念板块分组（来自今日热门概念成分股反查）",
      },
      fromLLM: false,
    };
  } catch (e) {
    console.warn("[stockToMainline] 概念板块降级也失败:", e);
    // 终极兜底：按 hybk
    return legacyFallbackByHybk(input);
  }
}

// 兜底再兜底：原 hybk 逻辑（保留作为最后防线）
function legacyFallbackByHybk(input: ClassifyInput): ClassifyResult {
  // v9.26.17：全量遍历（原 slice(0,50) 截断漏掉后 70 只涨停）
  const stockMap = new Map<string, StockToMainline>();
  for (const p of input.rawPool) {
    const code = String(p.c ?? "");
    if (!code) continue;
    stockMap.set(code, {
      code, name: String(p.n ?? ""),
      hybk: String(p.hybk ?? "其他"),
      mainline: String(p.hybk ?? "其他") || "其他",
      confidence: 25,
    });
  }
  const hybkGroups = new Map<string, ZTPoolItem[]>();
  for (const p of input.rawPool) {
    const key = String(p.hybk ?? "其他");
    const arr = hybkGroups.get(key) ?? [];
    arr.push(p);
    hybkGroups.set(key, arr);
  }
  const groups: MainlineGroup[] = [];
  for (const [hybk, items] of hybkGroups) {
    if (items.length < 2) continue;
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
      mainline: hybk, ztCount: items.length, leaders,
      height: Math.max(...items.map(i => i.lbc ?? 1)),
      mainNet, mainNet5d, boardPct,
      newsTitles: input.newsItems.filter(n => n.title.includes(hybk)).slice(0, 3).map(n => n.title),
      isPulse: items.length < 3,
      logic: `终极兜底（LLM+概念均失败）：按 hybk 行业分组合计${items.length}只`,
      caution: items.length < 3 ? "涨停数<3，板块效应弱" : "",
      score: items.length >= 3 ? 40 : items.length === 2 ? 20 : 0,
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
      logic: "终极兜底（LLM+概念均失败）：按申万行业 hybk 分组",
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
  // v9.32.1（缺口4）：板型判定（hs=换手率：<1 一字板难上车；1-5 缩量板；≥5 换手板可上车）
  const boardTypeOf = (p: ZTPoolItem): "一字板" | "缩量板" | "换手板" => {
    const hs = p.hs ?? 0;
    if (hs < 1) return "一字板";
    if (hs < 5) return "缩量板";
    return "换手板";
  };
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
    boardType: boardTypeOf(top),
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
    boardType: boardTypeOf(dragon2),
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
    boardType: boardTypeOf(dragon3),
    });
  }
  return leaders;
}

function fmtFbt(t: number): string {
  const s = String(t).padStart(6, "0");
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
}

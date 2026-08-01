// Agnes 深度情报中枢 v2
// 代码统计 + 模型研判 + 来源溯源 + 分段/终盘写盘

import { callAI, parseAIJSON, getApiKey } from "./ai";
import { saveDailyMemo, saveSegmentMemo, getRecentMemos, type DailyNewsMemo, type IntelSlot } from "./newsMemoStore";
import { computeStats, formatStatsForPrompt, formatMarketBlock, pickTopSourced } from "./intelStats";

// ============== 统一字段名 ==============
export interface NewsItem {
  code: string;
  title: string;
  summary: string;
  boards: string[];
  sentiment: "positive" | "negative" | "neutral";
  stars: number;
  isOverseas: boolean;
  time: string;
  url: string;
}

export interface AnnItem {
  artCode: string;
  stockCode: string;
  stockName: string;
  title: string;
  columnName: string;
  boards: string[];
  score?: number;
  logic?: string;
  time: string;
  url: string;
}

// ============== 输入 ==============
export interface IntelligenceInput {
  date: string;
  slot: IntelSlot;
  news: NewsItem[];
  announcements: AnnItem[];
  marketSnapshot?: {
    sentiment: number;
    indices: Array<{ name: string; pct: number }>;
    mainNet: number;
    mainNet5d: number;
    mainNet10d: number;
  } | null;
  limitPool?: { limitUpCount: number; blastedRate: number; maxBoard?: number | null } | null;
  strongBoards: string[];
}

// ============== 核心函数 ==============

export async function generateDailyIntelligence(input: IntelligenceInput): Promise<DailyNewsMemo | null> {
  // 无 API Key → null（UI 显示友好提示）
  if (!getApiKey()) return null;
  // news + ann 都空 → null（UI 显示"数据不足"）
  if (input.news.length === 0 && input.announcements.length === 0) return null;

  // ① 代码统计（模型不数数）
  const stats = computeStats(input.news, input.announcements);
  const statsBlock = formatStatsForPrompt(stats);
  const marketBlock = formatMarketBlock(input.marketSnapshot ?? null, input.limitPool ?? null);
  const topSourced = pickTopSourced(stats, 5);

  // ② 历史记忆
  const history = getRecentMemos(5);
  const historyText = history.length > 0
    ? history.map(m => `${m.date}: ${m.cycleStage} 主线=${m.focusThemes.join("/")} 趋势=${m.trend?.slice(0, 30) ?? "—"}`).join("\n")
    : "无历史记忆（首次运行）";

  // ③ 支撑原文（模型只读不数）
  const sourceBlock = topSourced.map(b =>
    `[${b.board}]\n${b.items.map(i => `- ${i.title}${i.url ? " " + i.url : ""}`).join("\n")}`
  ).join("\n");

  // ④ 构造 Prompt
  const result = await callAI("stockJudge", {
    prompt: `你是A股顶级独立游资，擅长从消息流中提炼主线脉络。

重要规则：
1. 只输出合法 JSON，不输出任何其他文字或 markdown 标记
2. 行业/事件判断只能从下方给定的素材中归纳，严禁捏造不存在的消息
3. 每条 positiveIndustries/negativeIndustries 的 source 字段 = 支撑该判断的原文标题
4. 每条 topEvents 的 source 字段 = 原始快讯/公告标题
5. whatMarketTrades 和 trend 必须引用具体数字

===历史5日主线记忆===
${historyText}

${statsBlock}

${marketBlock}

===支撑原文（热度最高板块的头条）===
${sourceBlock || "暂无"}

===资金净流入强势板块===
${input.strongBoards.join("、") || "暂无数据"}

===输出 JSON 结构===
{
  "cycleStage": "启动期|发酵期|高潮期|分歧期|退潮期",
  "focusThemes": ["主线1", "主线2"],
  "whatMarketTrades": "市场在交易什么（带数字，如'半导体涨停12只占全市场18%'）",
  "trend": "当前趋势研判（1-2句，引用指数涨跌/资金数据）",
  "positiveIndustries": [{"name": "行业名", "count": 利好数, "resonance": true/false, "source": "原文标题"}],
  "negativeIndustries": [{"name": "行业名", "count": 利空数, "source": "原文标题"}],
  "topEvents": [{"title": "事件标题", "stars": 2或3, "impact": "游资解读", "source": "原始标题", "sourceUrl": "如有"}],
  "directionAdvice": "短线进攻/避坑指引（≤80字）",
  "rawSummary": "全盘演进分析（≤400字）"
}`,
  });

  // ⑤ 降级
  if (result.degraded) {
    const fb = buildFallback(input, stats);
    writeMemo(input.date, input.slot, fb);
    return fb;
  }

  // ⑥ 解析
  const parsed = parseAIJSON<Record<string, unknown>>(result.text);
  if (!parsed) {
    const fb = buildFallback(input, stats);
    fb.rawSummary = result.text;
    writeMemo(input.date, input.slot, fb);
    return fb;
  }

  // ⑦ 组装 memo + 来源溯源
  const memo = assembleMemo(input, parsed, result.text);

  // ⑧ 写盘
  writeMemo(input.date, input.slot, memo);
  return memo;
}

// ============== 内部工具 ==============

function writeMemo(date: string, slot: IntelSlot, memo: DailyNewsMemo): void {
  if (slot === "final") {
    saveDailyMemo(memo);
  } else {
    saveSegmentMemo(date, slot, memo);
  }
}

function buildFallback(input: IntelligenceInput, stats: ReturnType<typeof computeStats>): DailyNewsMemo {
  const topBoards = stats.boardStats.filter(b => b.netScore > 0).slice(0, 3);
  return {
    date: input.date,
    cycleStage: "分歧期",
    focusThemes: input.strongBoards.slice(0, 3),
    whatMarketTrades: topBoards.length > 0
      ? `${topBoards.map(b => `${b.board}(热度${b.netScore >= 0 ? "+" : ""}${b.netScore})`).join("、")}`
      : "数据不足",
    trend: input.marketSnapshot
      ? `情绪${input.marketSnapshot.sentiment}分 主力净额${(input.marketSnapshot.mainNet / 1e8).toFixed(1)}亿`
      : "暂无行情数据",
    positiveIndustries: topBoards.map(b => ({
      name: b.board, count: b.positive, resonance: false,
      source: b.topItems[0]?.title ?? "规则版",
    })),
    negativeIndustries: stats.boardStats.filter(b => b.netScore < -2).slice(0, 3).map(b => ({
      name: b.board, count: b.negative, source: b.topItems[0]?.title ?? "规则版",
    })),
    topEvents: input.announcements.slice(0, 3).map(a => ({
      title: a.title, stars: a.score && a.score >= 4 ? 3 : 2,
      impact: "规则版", source: a.title, sourceUrl: a.url,
    })),
    directionAdvice: "AI暂不可用，请配置 API Key 后重试",
    rawSummary: `规则版（${stats.boardStats.length}个板块、${stats.eventStructure.policy}条政策、${stats.eventStructure.company}条公司）`,
    updatedAt: Date.now(),
  };
}

function assembleMemo(input: IntelligenceInput, parsed: Record<string, unknown>, rawText: string): DailyNewsMemo {
  const validStages = ["启动期", "发酵期", "高潮期", "分歧期", "退潮期"] as const;
  const rawStage = String(parsed.cycleStage ?? "分歧期");
  const cycleStage = validStages.includes(rawStage as any) ? rawStage as DailyNewsMemo["cycleStage"] : "分歧期";

  // 构建 source→url 查找表（精确→包含匹配）
  const urlMap = new Map<string, string>();
  for (const n of input.news) urlMap.set(n.title, n.url);
  for (const a of input.announcements) urlMap.set(a.title, a.url);
  function findUrl(source: string): string | undefined {
    if (urlMap.has(source)) return urlMap.get(source);
    for (const [title, url] of urlMap) {
      if (title.includes(source) || source.includes(title)) return url;
    }
    return undefined;
  }

  return {
    date: input.date,
    cycleStage,
    focusThemes: Array.isArray(parsed.focusThemes) ? parsed.focusThemes.map(String).slice(0, 5) : [],
    whatMarketTrades: String(parsed.whatMarketTrades ?? "").slice(0, 200),
    trend: String(parsed.trend ?? "").slice(0, 200),
    positiveIndustries: Array.isArray(parsed.positiveIndustries)
      ? parsed.positiveIndustries.filter((x: any) => x?.name).map((x: any) => ({
        name: String(x.name), count: Number(x.count) || 0, resonance: !!x.resonance,
        source: String(x.source ?? ""),
      })).slice(0, 8)
      : [],
    negativeIndustries: Array.isArray(parsed.negativeIndustries)
      ? parsed.negativeIndustries.filter((x: any) => x?.name).map((x: any) => ({
        name: String(x.name), count: Number(x.count) || 0,
        source: String(x.source ?? ""),
      })).slice(0, 5)
      : [],
    topEvents: Array.isArray(parsed.topEvents)
      ? parsed.topEvents.filter((x: any) => x?.title).map((x: any) => {
        const src = String(x.source ?? x.title);
        const resolvedUrl = x.sourceUrl ? String(x.sourceUrl) : findUrl(src);
        const impact = resolvedUrl ? String(x.impact ?? "") : `⚠️未溯源：${String(x.impact ?? "")}`;
        return { title: String(x.title), stars: Number(x.stars) || 2, impact, source: src, sourceUrl: resolvedUrl };
      }).slice(0, 5)
      : [],
    directionAdvice: String(parsed.directionAdvice ?? "").slice(0, 120),
    rawSummary: String(parsed.rawSummary ?? rawText).slice(0, 600),
    updatedAt: Date.now(),
  };
}

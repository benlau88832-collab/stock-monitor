// Agnes AI 任务模板库
// 每个任务一个模板函数；全部共享同一段 system 前缀。

const SYSTEM_PREFIX = `你是游资与机构双视角的A股实战复盘分析师。
只输出结论与数字；禁止任何免责声明与"仅供参考"类措辞；
禁止"较多/明显"等模糊词，必须引用输入的具体数值；
严格按给定小标题分段，每段不超过3行；语言精悍。`;

export function getSystemPrefix(): string { return SYSTEM_PREFIX; }

// ============== 任务枚举 ==============
export type AITask =
  | "preopenPlan" | "closeReview" | "annRank" | "ladderScan"
  | "newsDigest" | "weeklyCoach" | "stockJudge" | "policyDiff" | "supervisor";

// ============== 任务分级参数 ==============
export interface TaskConfigItem { temperature: number; maxTokens: number; thinking: boolean; }
export const TASK_CONFIG: Record<AITask, TaskConfigItem> = {
  preopenPlan: { temperature: 0.4, maxTokens: 900, thinking: false },
  closeReview: { temperature: 0.3, maxTokens: 1200, thinking: true },
  annRank:     { temperature: 0.1, maxTokens: 1500, thinking: false },
  ladderScan:  { temperature: 0.3, maxTokens: 700, thinking: false },
  newsDigest:  { temperature: 0.3, maxTokens: 400, thinking: false },
  weeklyCoach: { temperature: 0.4, maxTokens: 1500, thinking: true },
  stockJudge:  { temperature: 0.3, maxTokens: 8000, thinking: true },
  supervisor:  { temperature: 0.4, maxTokens: 4000, thinking: false },
  policyDiff:  { temperature: 0.2, maxTokens: 1500, thinking: true },
};

// ============== 任务负载类型 ==============
export interface AITaskPayload {
  preopenPlan: {
    date: string; sentiment: number; sentimentLabel: string;
    limitUpCount: number; blastedRate: number; maxBoard: number;
    ladderTop3: string; annSeeds: string; overnightSignals: string;
  };
  closeReview: {
    date: string; planText: string; sentiment: number;
    limitUpCount: number; limitDownCount: number; blastedRate: number;
    ladderChange: string; mainBoardPct: string; alertsLog: string;
    executed: string | null;
  };
  annRank: {
    announcements: Array<{ code: string; name: string; title: string; column: string }>;
  };
  ladderScan: {
    groups: Array<{ theme: string; height: number; count: number; pioneer: string }>;
    sentiment: number; blastedRate: number; brokenBoards: string;
  };
  newsDigest: { headlines: string[] };
  weeklyCoach: {
    weekEntries: Array<{
      date: string; plan: string; executed: string | null;
      aiHitRate: string; sentiment: number | null;
    }>;
    hitRateContext?: string; // 推荐归因命中率上下文（由 recTracker 注入）
  };
  stockJudge: { prompt: string };
  supervisor: { system: string; user: string };
  policyDiff: { policyText: string };
}

// ============== Prompt 构建器 ==============
type PB<T extends AITask> = (p: AITaskPayload[T]) => { system: string; user: string };
const B: { [K in AITask]: PB<K> } = {
  preopenPlan: (p) => ({ system: SYSTEM_PREFIX, user:
`日期：${p.date}
以下为昨日(T-1)收盘数据：
- 情绪分：${p.sentiment}(${p.sentimentLabel})
- 涨停${p.limitUpCount}只，炸板率${p.blastedRate.toFixed(1)}%，最高板${p.maxBoard}
- 题材梯队前3：${p.ladderTop3 || "无该项"}
- 公告★★★种子：${p.annSeeds || "无该项"}
- 隔夜外围：${p.overnightSignals || "无该项"}

严格按以下四个标题输出，禁止增减标题：
【今日主线假设】1-2句+依据数字
【出手条件】最多3条，格式"若X则Y"
【风险红线】最多2条
【备选剧本】主线被证伪时的替代方向1个` }),

  closeReview: (p) => ({ system: SYSTEM_PREFIX, user:
`日期：${p.date}
今日预案原文：${p.planText || "未填写"}

今日实际数据：
- 情绪分：${p.sentiment}
- 涨停${p.limitUpCount}，跌停${p.limitDownCount}，炸板率${p.blastedRate.toFixed(1)}%
- 梯队变化：${p.ladderChange || "无该项"}
- 主线板块涨跌：${p.mainBoardPct || "无该项"}
- 警报记录：${p.alertsLog || "无"}
- 执行度自评：${p.executed || "未勾选"}

严格按以下三个标题输出，禁止增减标题：
【剧本命中度】X/3，逐条标注成立与否+数据
【偏差归因】2-3句，必须引用数字
【明日剧本草案】3条` }),

  // 公告归因：输出纯 JSON 数组
  annRank: (p) => ({ system:
`你是A股公告分析师。只返回JSON数组，无任何其他文字。
每个元素: {code:string, theme:string, score:1-5, logic:string(≤30字), watch:string(≤20字)}
score含义: 5=重大利好必关注 4=强利好 3=中性偏多 2=弱关注 1=无关/利空`, user:
`对以下公告评分排序：
${p.announcements.map(a => `${a.code} ${a.name}: ${a.title} [${a.column}]`).join("\n")}` }),

  // 梯队把脉
  ladderScan: (p) => ({ system: SYSTEM_PREFIX, user:
`当前涨停题材梯队（按高度排序）：
${p.groups.map(g => `${g.theme}: ${g.height}板 ${g.count}只 先锋=${g.pioneer}`).join("\n")}
情绪分${p.sentiment}，炸板率${p.blastedRate.toFixed(1)}%
断板名单：${p.brokenBoards || "无"}

严格按以下三个标题输出：
【周期定位】当前处于什么阶段（启动/发酵/高潮/退潮），1-2句
【明日看点】≤3条，每条具体到题材+操作方向
【断板风险】≤3只，含原因` }),

  // 快讯三行
  newsDigest: (p) => ({ system:
`你是A股快讯浓缩器。严格输出恰好3行，每行≤40字，必须含事件名。
格式：
【政策面】...
【资金/市场面】...
【外围/风险】...
若某一面无重要增量，该行写"无重要增量"。禁止其他内容。`, user:
`最近快讯标题：
${p.headlines.join("\n")}` }),

  // 周报教练
  weeklyCoach: (p) => ({ system: SYSTEM_PREFIX, user:
`本周交易记录：
${p.weekEntries.map(e => `${e.date}: 预案「${e.plan || "未填"}」执行=${e.executed || "未评"} 命中=${e.aiHitRate} 情绪=${e.sentiment ?? "—"}`).join("\n")}
${p.hitRateContext ? `\n推荐归因统计：${p.hitRateContext}` : ""}

严格按以下三个标题输出：
【纪律执行率】X%，计算依据
【重复错误模式】≤2条，必须引用具体日期
【下周动作】恰好2条可执行项` }),

  stockJudge: (p) => ({ system: SYSTEM_PREFIX, user: p.prompt }),

  // 督导室专用：system/user 由 IntelligenceDrawer 构建，此处透传
  supervisor: (p) => ({ system: p.system, user: p.user }),

  policyDiff: (p) => ({ system: SYSTEM_PREFIX, user:
`对比分析以下政策文本对A股各板块的影响：
${p.policyText}

按以下结构输出：
## 利好板块
## 利空板块
## 资金方向` }),
};

export function buildPrompt<T extends AITask>(task: T, payload: AITaskPayload[T]) {
  return B[task](payload);
}

// ============== 规则版 fallback ==============
type FF<T extends AITask> = (p: AITaskPayload[T]) => string;
export const FALLBACKS: { [K in AITask]: FF<K> } = {
  preopenPlan: (p) => {
    const s = p.sentiment;
    if (s >= 65) return `【今日主线假设】昨日情绪${s}分，涨停${p.limitUpCount}只，强势延续\n【出手条件】若主线竞价>3%半仓跟；溢价<0观望\n【风险红线】溢价<0减半仓；炸板率>${p.blastedRate.toFixed(0)}%清仓\n【备选剧本】高位核按钮→低位补涨`;
    if (s <= 35) return `【今日主线假设】昨日情绪${s}分，恐慌，超跌反弹\n【出手条件】放量反包试仓2成；新低空仓\n【风险红线】亏5%止损；不追板\n【备选剧本】继续杀跌→避险板块`;
    return `【今日主线假设】昨日情绪${s}分，涨停${p.limitUpCount}只，中性震荡\n【出手条件】放量突破跟进；缩量观望\n【风险红线】单票亏5%止损；仓位不超6成\n【备选剧本】主线走弱→${p.ladderTop3 ? "新晋方向" : "低位补涨"}`;
  },
  closeReview: (p) => `【剧本命中度】—/3（规则版）\n预案：${(p.planText || "未填写").slice(0, 80)}\n今日：情绪${p.sentiment} 涨停${p.limitUpCount} 跌停${p.limitDownCount} 炸板${p.blastedRate.toFixed(1)}%\n【偏差归因】规则版无法归因\n【明日剧本草案】请AI可用时重试`,
  annRank: (p) => p.announcements.slice(0, 5).map((a, i) => `${i + 1}. ${a.name}: ${a.title.slice(0, 30)}`).join("\n"),
  ladderScan: (p) => {
    const top = p.groups.filter(g => g.height >= 3);
    const zt = p.groups.reduce((s, g) => s + g.count, 0);
    // 阈值表：涨停数/炸板率/最高板 → 周期定位
    let phase = "震荡";
    const maxH = p.groups.length > 0 ? p.groups[0].height : 0;
    if (zt >= 80 && p.blastedRate < 15 && maxH >= 5) phase = "高潮期";
    else if (zt >= 50 && p.blastedRate < 20) phase = "发酵期";
    else if (zt >= 30) phase = "启动期";
    else if (zt < 20 || p.blastedRate > 30) phase = "退潮期";
    return `【周期定位】${phase}（涨停${zt}只 炸板率${p.blastedRate.toFixed(1)}% 最高${maxH}板）\n【明日看点】${top.length > 0 ? top.slice(0, 3).map(g => `${g.theme}(${g.height}板)`).join("、") : "暂无明确主线"}\n【断板风险】${p.brokenBoards || "无"}`;
  },
  newsDigest: (p) => {
    const h = p.headlines;
    return `【政策面】${h.find(x => /国务院|央行|证监会|发改委/.test(x))?.slice(0, 38) || "无重要增量"}\n【资金/市场面】${h.find(x => /资金|成交|涨停|跌停|ETF/.test(x))?.slice(0, 38) || "无重要增量"}\n【外围/风险】${h.find(x => /美|欧|日|关税|地缘|原油/.test(x))?.slice(0, 38) || "无重要增量"}`;
  },
  weeklyCoach: (p) => {
    const total = p.weekEntries.length;
    const executed = p.weekEntries.filter(e => e.executed === "yes").length;
    const rate = total > 0 ? Math.round(executed / total * 100) : 0;
    return `【纪律执行率】${rate}%（${executed}/${total}天执行预案）\n【重复错误模式】规则版无法分析\n【下周动作】1.坚持盘前写预案 2.控制单票仓位`;
  },
  stockJudge: (p) => `个股研判规则版：\n${p.prompt.slice(0, 150)}...\n数据不足或限速，请先在个股雷达添加/刷新个股后再问。`,
  supervisor: (p) => `AI督导暂不可用，请稍后重试。\n\n提问：${p.user.slice(-100)}`,
  policyDiff: (p) => `政策摘要：\n${p.policyText.slice(0, 200)}...\n规则版无法深度对比。`,
};

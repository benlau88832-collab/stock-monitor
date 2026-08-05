// Agnes AI 任务模板库
// 每个任务一个模板函数；全部共享同一段 system 前缀。

const SYSTEM_PREFIX = `你是游资与机构双视角的A股实战复盘分析师。
只输出结论与数字；输出须引用输入的具体数值，禁止"较多/明显"等模糊词；
结论表述采用中性强度词（如"关注度较高/风险偏高/参考档位"），避免绝对化买卖指令；
严格按给定小标题分段，每段不超过3行；语言精悍。`;

export function getSystemPrefix(): string { return SYSTEM_PREFIX; }

// ============== 任务枚举 ==============
export type AITask =
  | "preopenPlan" | "closeReview" | "annRank" | "ladderScan"
  | "newsDigest" | "weeklyCoach" | "stockJudge" | "policyDiff" | "supervisor"
  | "mainlineClassify" | "mainlineDiagnosis" | "mainlineRank" | "eventExplain"
  // v9.28（P1-9）：独立业务 task —— 避免复用 mainlineRank/stockJudge 造成缓存串任务与 token 配置错配
  | "themeNewsScore" | "stockNewsScore" | "dailyIntel"
  // v9.33（缺口2/3）：盘后自动复盘 + 次日三剧本 + 龙头预判 + 风险雷达
  | "dailyReviewAuto" | "nextDayScenarios" | "leaderPredict" | "riskRadar"
  // v9.38（V3-12）：事件三级分类（政策/行业/事件）
  | "eventClassify"
  // v9.38.1（V3-14）：单事件深挖（仅高分事件触发，控成本）
  | "eventDeepDive";

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
  mainlineClassify: { temperature: 0.1, maxTokens: 4000, thinking: false },
  mainlineDiagnosis: { temperature: 0.2, maxTokens: 1500, thinking: false },
  // v9.26 F-05：主线精排专用任务 —— 低延迟确定性优先（thinking=false、低温、小输出）
  mainlineRank: { temperature: 0.1, maxTokens: 1500, thinking: false },
  // v9.26 A.6：异动事件一句话解释（事件驱动，每 eventId 一次，小 schema）
  eventExplain: { temperature: 0.2, maxTokens: 300, thinking: false },
  supervisor:  { temperature: 0.4, maxTokens: 4000, thinking: false },
  policyDiff:  { temperature: 0.2, maxTokens: 1500, thinking: true },
  // v9.28（P1-9）：独立业务 task —— 主题新闻评分 / 个股新闻评分 / 每日情报
  // 均关闭 thinking（结构化 JSON 输出），避免此前复用 stockJudge(thinking=true) 的高延迟与配额浪费
  themeNewsScore: { temperature: 0.2, maxTokens: 1200, thinking: false },
  stockNewsScore: { temperature: 0.2, maxTokens: 1200, thinking: false },
  dailyIntel:     { temperature: 0.3, maxTokens: 2000, thinking: false },
  // v9.33（缺口2/3）：盘后自动复盘 / 次日三剧本 / 龙头预判 / 风险雷达
  dailyReviewAuto: { temperature: 0.3, maxTokens: 2000, thinking: false },
  nextDayScenarios: { temperature: 0.4, maxTokens: 1000, thinking: false },
  leaderPredict:   { temperature: 0.2, maxTokens: 600, thinking: false },
  riskRadar:       { temperature: 0.2, maxTokens: 800, thinking: false },
  // v9.38（V3-12）：事件三级分类（政策级/行业级/事件级）—— 批量小输出
  eventClassify:   { temperature: 0.1, maxTokens: 1500, thinking: false },
  // v9.38.1（V3-14）：单事件深挖（仅高分事件触发，控成本）
  eventDeepDive:   { temperature: 0.3, maxTokens: 800, thinking: false },
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
  mainlineClassify: { prompt: string };
  mainlineDiagnosis: { prompt: string };
  mainlineRank: { prompt: string };
  eventExplain: { prompt: string };
  supervisor: { system: string; user: string };
  policyDiff: { policyText: string };
  // v9.28（P1-9）：新闻评分 / 每日情报（结构化 JSON 输出，独立 task 独立参数）
  themeNewsScore: { prompt: string };
  stockNewsScore: { prompt: string };
  dailyIntel: { prompt: string };
  // v9.33（缺口2/3）
  dailyReviewAuto: {
    date: string; mainlines: string; topStocks: string;
    missedThemes: string; sentiment: number; blastedRate: number;
    blackSwans: string; annHighlights: string; userReview: string | null;
  };
  nextDayScenarios: { prompt: string };
  leaderPredict: { prompt: string };
  riskRadar: { prompt: string };
  eventClassify: { events: Array<{ title: string; source: string }> };
  eventDeepDive: { title: string; level: string; catalystScore: number; beneficiaries: string[] };
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
  // 主线归类专用：thinking=false（快+稳），temperature 0.1（确定性优先）
  mainlineClassify: (p) => ({ system: SYSTEM_PREFIX, user: p.prompt }),
  // v9.23-4 主线诊断专用：结构化 JSON 输出（PRD 7.2 mainline_diagnosis schema）
  mainlineDiagnosis: (p) => ({ system: SYSTEM_PREFIX, user: p.prompt }),
  // v9.26 F-05 主线精排专用：thinking=false（快+稳），temperature 0.1（确定性优先）
  mainlineRank: (p) => ({ system: SYSTEM_PREFIX, user: p.prompt }),
  // v9.26 A.6 异动事件解释：一句<=40字归因 + 建议动作
  eventExplain: (p) => ({ system: SYSTEM_PREFIX, user: p.prompt }),

  // 督导室专用：system/user 由 IntelligenceDrawer 构建，此处透传
  supervisor: (p) => ({ system: p.system, user: p.user }),

  policyDiff: (p) => ({ system: SYSTEM_PREFIX, user:
`对比分析以下政策文本对A股各板块的影响：
${p.policyText}

按以下结构输出：
## 利好板块
## 利空板块
## 资金方向` }),
  // v9.28（P1-9）：主题新闻评分（结构化 JSON，与 mainlineRank 解耦）
  themeNewsScore: (p) => ({ system:
`你是A股题材新闻评分器。只返回JSON数组，无其他文字。
每个元素: {theme:string, score:0-100, reason:string(≤30字)}
score=新闻对该题材的催化强度（0=无关 100=强催化）`, user: p.prompt }),
  // v9.28（P1-9）：个股新闻评分（结构化 JSON）
  stockNewsScore: (p) => ({ system:
`你是A股个股新闻评分器。只返回JSON对象，无其他文字。
格式: {score:0-100, sentiment:"利好"|"利空"|"中性", reason:string(≤30字)}
score=新闻对该股的短线影响强度`, user: p.prompt }),
  // v9.28（P1-9）：每日情报综合（独立 task，避免误开 thinking）
  dailyIntel: (p) => ({ system: SYSTEM_PREFIX, user: p.prompt }),
  // v9.33（缺口2）：盘后自动复盘 —— 今日主线回顾/错过主线/明日关注清单
  dailyReviewAuto: (p) => ({ system: SYSTEM_PREFIX, user:
`日期：${p.date}，盘后自动复盘。

今日主线：${p.mainlines || "无"}
核心个股：${p.topStocks || "无"}
今日错过/未主升方向：${p.missedThemes || "无"}
情绪分：${p.sentiment}，炸板率：${p.blastedRate.toFixed(1)}%
黑天鹅公告：${p.blackSwans || "无"}
强催化公告：${p.annHighlights || "无"}
${p.userReview ? `用户手填复盘：${p.userReview}` : "（用户今日未手填复盘）"}

严格按以下四个标题输出，禁止增减标题，每段≤4行：
【今日主线回顾】最强主线/次强/退潮主线（引用具体数字）
【错过与教训】今日应关注但未出现信号的方向，及原因
【明日关注清单】3-5只候选（代码+名称+理由≤20字）
【风险提示】基于黑天鹅/炸板率/溢出的风险点` }),
  // v9.33（缺口3）：次日三剧本（盘后）
  nextDayScenarios: (p) => ({ system: SYSTEM_PREFIX, user:
`你是10年经验的A股龙头战法操盘手。基于以下今日收盘数据，推演明日3种剧本。

${p.prompt}

输出严格JSON数组（3项，按概率降序），格式：
[{"scenario":"主线延续","probability":60,"conditions":["条件1","条件2"],"focus":["关注股或方向"]},
 {"scenario":"分歧换手","probability":30,"conditions":["..."],"focus":["..."]},
 {"scenario":"高位退潮","probability":10,"conditions":["..."],"focus":["..."]}]
conditions≤3条，focus≤2项。只返回JSON数组，无其他文字。` }),
  // v9.33（缺口3）：竞价段龙头预判
  leaderPredict: (p) => ({ system: SYSTEM_PREFIX, user:
`你是A股龙头预判器。基于竞价与昨日涨停池数据，预判今日龙一。

${p.prompt}

输出严格JSON对象，格式：
{"predictLeader":{"code":"600000","name":"示例股"},"confidence":75,"reason":"≤30字","watch":"应盯防的卡位竞争者"}
只返回JSON对象，无其他文字。` }),
  // v9.33（缺口3）：全市场风险雷达
  riskRadar: (p) => ({ system: SYSTEM_PREFIX, user:
`你是A股风险雷达。扫描以下数据，输出今日风险等级与关注点。

${p.prompt}

输出严格JSON对象，格式：
{"level":"高|中|低","points":[{"item":"风险点1","desc":"≤30字"},{"item":"风险点2","desc":"≤30字"}],"advice":"≤40字"}
只返回JSON对象，无其他文字。` }),
  // v9.38（V3-12）：事件三级分类（政策/行业/事件）
  eventClassify: (p) => ({ system: SYSTEM_PREFIX, user:
`你是A股事件分级器。对以下新闻/公告事件做三级分类并评估影响。

事件列表（标题|来源）：
${p.events.map(e => `- ${e.title} | ${e.source}`).join("\n") || "（无）"}

输出严格JSON数组，每事件一项：
[{"title":"原标题","level":"政策|行业|事件","beneficiaries":["受益板块1","板块2"],"catalystScore":0-100,"timeSensitivity":"即时|短期|中长期","reason":"≤25字"}]
分级规则：
- 政策级：国务院/央行/证监会/发改委/国常会/部委发文 → beneficiaries 给受益行业清单
- 行业级：产业链事件/涨价/订单/技术突破 → beneficiaries 给细分方向
- 事件级：个股公告/中标/减持 → beneficiaries 给该股行业
catalystScore 按影响力度：国常会级 85-100 / 部委级 65-84 / 行业级 40-64 / 个股级 20-40
只返回JSON数组，无其他文字。` }),
  // v9.38.1（V3-14）：单事件深挖（Agent 工具 getNewsDeep 用；仅高分事件触发）
  eventDeepDive: (p) => ({ system: SYSTEM_PREFIX, user:
`你是A股事件深挖分析师。对以下已分级事件做影响推演，回答三个问题并给结论。

事件标题：${p.title}
事件级别：${p.level}
催化强度：${p.catalystScore}/100
受益方向：${(p.beneficiaries || []).join("、") || "待定"}

请输出严格JSON对象：
{"chain":"从事件到板块到个股的影响传导路径(≤60字)","targets":[{"name":"最可能受益标的/板块","reason":"≤20字"}],"risk":"反面风险或未兑现的可能(≤30字)","confirm":"验证该催化是否兑现的观察信号(≤30字,如'看龙头竞价封单'/'看板块主力资金')","conclusion":"一句话结论(≤30字)"}
只返回JSON对象，无其他文字。` }),
};

export function buildPrompt<T extends AITask>(task: T, payload: AITaskPayload[T]) {
  return B[task](payload);
}

// ============== 规则版 fallback ==============
type FF<T extends AITask> = (p: AITaskPayload[T]) => string;
export const FALLBACKS: { [K in AITask]: FF<K> } = {
  preopenPlan: (p) => {
    const s = p.sentiment;
    if (s >= 65) return `【今日主线假设】昨日情绪${s}分，涨停${p.limitUpCount}只，强势延续\n【出手条件】若主线竞价>3%半仓跟；溢价<0观望\n【风险红线】溢价<0减半仓；炸板率>35%清仓（当前${p.blastedRate.toFixed(0)}%）\n【备选剧本】高位核按钮→低位补涨`;
    if (s <= 35) return `【今日主线假设】昨日情绪${s}分，恐慌，超跌反弹\n【出手条件】放量反包试仓2成；新低空仓\n【风险红线】亏5%止损；不追板\n【备选剧本】继续杀跌→避险板块`;
    return `【今日主线假设】昨日情绪${s}分，涨停${p.limitUpCount}只，中性震荡\n【出手条件】放量突破跟进；缩量观望\n【风险红线】单票亏5%止损；仓位不超6成\n【备选剧本】主线走弱→${p.ladderTop3 ? "新晋方向" : "低位补涨"}`;
  },
  closeReview: (p) => `【剧本命中度】—/3（规则版）\n预案：${(p.planText || "未填写").slice(0, 80)}\n今日：情绪${p.sentiment} 涨停${p.limitUpCount} 跌停${p.limitDownCount} 炸板${p.blastedRate.toFixed(1)}%\n【偏差归因】规则版无法归因\n【明日剧本草案】请AI可用时重试`,
  annRank: (p) => {
    // 修复：fallback 必须返回 JSON 数组，prompt 明确要求「只返回JSON数组」。
    // 之前返回 markdown（"1. xxx: xxx..."），导致 parseAIJSON 提取失败 → 用户看不到任何评分。
    const arr = p.announcements.slice(0, 5).map((a) => ({
      code: a.code,
      theme: a.column || "未分类",
      score: 3, // 规则版兜底：中性偏多
      logic: `${a.name} ${a.title.slice(0, 25)}`.slice(0, 30),
      watch: "AI暂不可用",
    }));
    return JSON.stringify(arr);
  },
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
  mainlineDiagnosis: (p) => `主线诊断规则版（LLM不可用）：\n${p.prompt.slice(0, 200)}...\n请参考主线强度分与离场信号规则引擎输出。`,
  mainlineClassify: (p) => `主线归类规则版（LLM不可用）：\n${p.prompt.slice(0, 200)}...\n按申万行业 hybk 分组。`,
  mainlineRank: (p) => `主线精排规则版（LLM不可用）：\n${p.prompt.slice(0, 200)}...\n按规则引擎分数排序。`,
  eventExplain: (p) => `异动解释规则版（LLM不可用）：\n${p.prompt.slice(0, 200)}...\n请以规则卡原因为准。`,
  supervisor: (p) => `AI督导暂不可用，请稍后重试。\n\n提问：${p.user.slice(-100)}`,
  policyDiff: (p) => `政策摘要：\n${p.policyText.slice(0, 200)}...\n规则版无法深度对比。`,
  themeNewsScore: (_p) => JSON.stringify([{ theme: "未知", score: 50, reason: "规则版（LLM不可用）" }]),
  stockNewsScore: (_p) => JSON.stringify({ score: 50, sentiment: "中性", reason: "规则版（LLM不可用）" }),
  dailyIntel: (p) => `每日情报规则版（LLM不可用）：\n${p.prompt.slice(0, 200)}...\n请参考快讯与情绪数据。`,
  // v9.33（缺口2/3）规则版兜底
  dailyReviewAuto: (p) => `【今日主线回顾】规则版：${(p.mainlines || "无").slice(0, 80)}\n【错过与教训】规则版无法深度归因\n【明日关注清单】请AI可用时重试\n【风险提示】炸板率${p.blastedRate.toFixed(1)}%${p.blackSwans ? "；存在黑天鹅公告" : ""}`,
  nextDayScenarios: (_p) => JSON.stringify([
    { scenario: "主线延续", probability: 50, conditions: ["竞价主线高开>3%", "龙头一字封单>5亿"], focus: [] },
    { scenario: "分歧换手", probability: 30, conditions: ["高标开板", "炸板率上升"], focus: [] },
    { scenario: "高位退潮", probability: 20, conditions: ["龙头低开", "跌停家数增加"], focus: [] },
  ]),
  leaderPredict: (_p) => JSON.stringify({ predictLeader: null, confidence: 0, reason: "规则版（LLM不可用）", watch: "" }),
  riskRadar: (_p) => JSON.stringify({ level: "低", points: [], advice: "规则版（LLM不可用）" }),
  // v9.38（V3-12）规则版：按关键词粗分级
  eventClassify: (p) => JSON.stringify(
    p.events.slice(0, 10).map(e => {
      const t = e.title;
      let level: "政策" | "行业" | "事件" = "事件";
      if (/国务院|央行|证监会|发改委|国常会|部委|印发|通知|规划|试点|专项/.test(t)) level = "政策";
      else if (/产业链|涨价|订单|技术|量产|突破|扩产|招标/.test(t)) level = "行业";
      return { title: t.slice(0, 30), level, beneficiaries: [], catalystScore: level === "政策" ? 70 : level === "行业" ? 50 : 30, timeSensitivity: "短期", reason: "规则版分级" };
    }),
  ),
  // v9.38.1（V3-14）规则版：浅挖（关键词推受益方向）
  eventDeepDive: (p) => JSON.stringify({
    chain: `规则版：${p.title.slice(0, 30)} 影响传导待 LLM 深挖`,
    targets: [{ name: (p.beneficiaries || []).join("、") || p.title.slice(0, 12), reason: "规则版推荐" }],
    risk: "规则版无法推演风险，请配置 LLM Key 深挖",
    confirm: "看板块主力资金是否进场",
    conclusion: `事件${p.catalystScore >= 65 ? "强度高，重点跟踪" : "强度中，观察确认"}`,
  }),
};

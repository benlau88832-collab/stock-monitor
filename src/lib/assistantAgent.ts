// ============================================================
// v9.58（V8-8）：全局 AI 助手 —— 贯通全站的对话入口
// 用户任意提问（主线/个股/资金/消息/席位/仓位）→ ReAct 自主调全站工具 → 带数字的连贯答复
// 工具：agentTools 全套（主线级）+ getStockFundDetail(code)（个股资金，动态按代码查）
// 降级：配额受限/失败 → degraded（AIConsole 顶部显式标注 V8-10）
// v9.84.2（AI大脑层）：注入 /api/brain/context 大脑快照 + PG 查询工具组（本地部署）
// ============================================================
import { getAgentTools } from "./agentTools";
// v9.66.1：导入调研会话状态工具
import { getResearchTools, RESEARCH_SYSTEM, researchCtxNote } from "./researchTools";
import { callAgentChat, parseAIJSON, type AgentChatResult } from "./ai";
import { fmtMoney, getBJDateStr } from "./format";
import { isLocalServer } from "./cloudStore";

// ============== v9.84.2（AI大脑层 · 3.1）：大脑快照（60s 缓存） ==============
export interface BrainContext {
  date?: string;
  market?: { ztCount: number | null; blastedRate: number | null; maxBoardHeight: number | null; premiumAvg: number | null; sentiment: number | null };
  limitLadder?: { total: number; maxBoard: number; ladder: Array<{ code: string; name: string; lbc: number; hybk: string }>; boards: Array<{ board: string; count: number }> };
  mainlines?: { asOf: string | null; top: Array<{ theme: string; heat: number; verdict: string; action: string; picks: Array<{ code: string; name: string; correlation: number }> }> };
  boardFund?: { items: Array<{ board: string; mainNet: number }> };
  lhb?: { items: Array<{ code: string; name: string; netBuy: number }> };
  blackSwans?: Array<{ code: string; title: string; level: string }>;
  events?: Array<{ title: string; level: string; score: number }>;
  strongNews?: Array<{ code: string; name: string; title: string; column: string; score: number }>;
  gate?: { mode: string; factor: number; label: string };
}

let brainCache: { data: BrainContext; ts: number } | null = null;
const BRAIN_TTL = 60 * 1000;

/** 拉取大脑快照（本地部署；失败返回 null 不影响主流程） */
export async function fetchBrainContext(force = false): Promise<BrainContext | null> {
  if (!isLocalServer()) return null;
  if (!force && brainCache && Date.now() - brainCache.ts < BRAIN_TTL) return brainCache.data;
  try {
    const resp = await fetch("/api/brain/context", { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return null;
    const j = await resp.json();
    if (!j || typeof j !== "object" || !("market" in j)) return null;
    brainCache = { data: j, ts: Date.now() };
    return j;
  } catch { return null; }
}

/** 大脑快照 → 紧凑文本（注入 LLM 上下文） */
export function brainContextToText(b: BrainContext): string {
  if (!b) return "";
  const parts: string[] = [];
  const m = b.market ?? ({} as NonNullable<BrainContext["market"]>);
  parts.push(`【大脑快照 ${b.date ?? ""}】情绪${m.sentiment ?? "?"} · 涨停${m.ztCount ?? "?"}只 · 炸板率${m.blastedRate ?? "?"}% · 最高${m.maxBoardHeight ?? "?"}板 · 昨日涨停溢价${m.premiumAvg ?? "?"}%`);
  if (b.limitLadder?.boards?.length) {
    parts.push(`涨停板块分布：${b.limitLadder.boards.slice(0, 5).map(x => `${x.board}${x.count}只`).join("、")}`);
  }
  if (b.mainlines?.top?.length) {
    parts.push(`主线Top：${b.mainlines.top.map(t => `${t.theme}(热度${t.heat ?? "?"},${t.verdict ?? "?"})`).join(" / ")}`);
  }
  if (b.boardFund?.items?.length) {
    parts.push(`板块主力净流入Top：${b.boardFund.items.slice(0, 4).map(i => `${i.board}${fmtMoney(i.mainNet)}`).join("、")}`);
  }
  if (b.lhb?.items?.length) {
    parts.push(`龙虎榜净买入Top：${b.lhb.items.slice(0, 4).map(i => `${i.name}${fmtMoney(i.netBuy)}`).join("、")}`);
  }
  if (b.blackSwans?.length) parts.push(`⚠ 黑天鹅${b.blackSwans.length}条：${b.blackSwans.slice(0, 3).map(x => x.title).join("；")}`);
  if (b.strongNews?.length) parts.push(`公告强催化：${b.strongNews.slice(0, 3).map(x => `${x.name}${x.title}`).join("；")}`);
  if (b.gate) parts.push(`次日闸门：${b.gate.label}`);
  return parts.join("\n");
}

// ============== v9.84.2（AI大脑层 · 3.2）：PG 查询工具组（本地部署） ==============
const PG_TOOL_NAMES = ["newsByKeyword", "annsByStock", "ztHistory", "seatsByStock", "researchByStock", "marketDaily"] as const;

async function pgTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const resp = await fetch("/api/brain/pg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, args }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return { error: `PG 查询失败(HTTP ${resp.status})` };
    const j = await resp.json();
    return j?.items ?? j ?? [];
  } catch (e) { return { error: "PG 查询异常:" + String(e) }; }
}

function buildPgTools(): Array<{ name: string; description: string; kind: "data"; execute: (args: any) => Promise<unknown> }> {
  const defs: Record<string, string> = {
    newsByKeyword: '按关键词检索本地快讯（标题/摘要/板块匹配，来自东财 cron 每20分钟抓取）。问"某关键词/板块的消息/政策/利好"时用它，传 {keyword:"低空经济", limit:10}。返回含 sentiment/stars 的新闻列表。',
    annsByStock: '查个股公告（本地 PG），传 {code:"600001", limit:10}。返回公告标题/栏目/时间/URL。',
    ztHistory: '查历史涨停快照（本地 PG，近N日），传 {code:"600001", days:10} 查某股涨停记录，或 {days:10} 查全市场历史梯队。返回 code/name/lbc(连板)/hybk(行业)/date。',
    seatsByStock: '查个股龙虎榜席位台账（近N日），传 {code:"600001", days:30}。返回 deptName(营业部)/direction(买卖)/net(净额)/pctT1(T+1涨幅)。问"谁在买/席位加持"时用它。',
    researchByStock: '查个股深度调研报告（本地 PG），传 {code:"600001"}。返回 summary_json/valuation_json 等已产出的调研结论。',
    marketDaily: '查市场日指标历史序列（涨停/炸板/溢价/最高板/情绪，近N日），传 {limit:30}。回答"近期情绪趋势/历史对比"用它。',
  };
  return PG_TOOL_NAMES.map(name => ({
    name,
    description: defs[name],
    kind: "data" as const,
    execute: (args: any) => pgTool(name, args ?? {}),
  }));
}

export interface AssistantReply {
  reply: string;
  toolsCalled: string[];
  degraded: boolean;
  rateLimited?: boolean;
}

/**
 * v9.84.2（3.4）：简单问答判定 —— 纯询问类（情绪/情况/解释/趋势）无需工具数据，
 * 直接走 /api/ai/stream 真流式；需要实时工具数据的问题（能不能上车/调研/分析个股）仍走 ReAct。
 */
export function isSimpleQuestion(q: string): boolean {
  const t = q.trim();
  if (!t || t.length > 80) return false;
  if (/个股深度调研|能不能上车|可不可以买|值得买|要不要买|帮我分析|分析一下|怎么看|怎么样买|买不买|调研|推荐个股/.test(t)) return false;
  return /情绪|情况|消息|政策|事件|解释|什么意思|怎么样|如何|多少|趋势|原因|为什么/.test(t);
}

/** v9.84.2（3.4）：快速问答 system 拼装（大脑快照 + 页面状态，无工具） */
export async function buildQuickSystem(siteContext: AssistantSiteContext): Promise<string> {
  const brain = await fetchBrainContext();
  const head = "你是A股短线交易助手（10年游资操盘手）。基于下面的大盘快照与页面状态，直接回答用户问题。要求：先说结论再说依据；数据只引用快照中有的数字，快照没有的直说没有；回答≤200字。";
  const snap = brain ? brainContextToText(brain) : "";
  const page = [
    "当前最强主线：" + (siteContext.topMainline ?? "暂无"),
    "市场情绪：" + (siteContext.sentiment ?? "?") + "（" + (siteContext.sentimentLabel ?? "数据不足") + "）",
    siteContext.watchStocks ? "用户自选股：" + siteContext.watchStocks : "",
  ].filter(Boolean).join("\n");
  return head + "\n\n" + (snap ? snap + "\n\n" : "") + "【页面状态】\n" + page;
}

export interface AssistantSiteContext {
  /** 当前最强主线摘要（供"知道你在看什么"） */
  topMainline?: string;
  topMainlineScore?: number | null;
  topMainlineZtCount?: number;
  topMainlineHeight?: number;
  sentiment?: number | null;
  sentimentLabel?: string;
  marketNet?: number;          // 全市场主力净流入(元)
  watchStocks?: string;        // 自选股摘要（名称列表）
}

export async function runAssistantAgent(
  question: string,
  siteContext: AssistantSiteContext = {},
  opts?: {
    /** v9.66.1：多轮对话历史（AIConsole 传最近对话，深度调研"继续/深入"能衔接上文） */
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    /** v9.67：调研会话状态（标的/进度/已收集数据）—— 结构化上下文，LLM 每轮"记得" */
    researchCtx?: import("./researchTools").ResearchCtx | null;
  },
): Promise<AssistantReply> {
  // V13-3（P0）：妙想工具仅在用户消息包含"个股深度调研"六个字时加载（用户明确要求）
  // 其他任何问题（"今日消息""主线分析""某只票怎么样"）都不加载妙想工具 —— 只用本地数据工具 + LLM 推理
  // 自检补漏（V13-3）：调研会话进行中（researchCtx 存在）→ 保留妙想工具（用户"继续/深入"不中断五段式，
  //   六字只作启动触发，会话内持续可用）
  const isDeepResearch = question.includes("个股深度调研") || opts?.researchCtx != null;
  const maxRounds = isDeepResearch ? 12 : 5;
  // v9.84.2（AI大脑层）：本地部署时加载 PG 查询工具组（服务端 /api/brain/pg，受工具名白名单约束）
  const pgTools = isLocalServer() ? buildPgTools() : [];
  // V13-2/3（P0）：工具集条件加载 —— 本地工具始终有；妙想工具（researchQuote/researchData/researchSearch/searchNewsFull）仅深度调研时加入
  // 新增 getLocalNews（本地快讯/公告，秒回不调妙想）—— 用户问消息/新闻/政策/公告 MUST 用这个
  const tools = [
    ...getAgentTools(), // 本地决策工具（主线/资金/席位/仓位/选股/离场/因子等）
    ...pgTools,         // v9.84.2：PG 持久化数据查询（快讯检索/公告/涨停历史/席位/调研/市场日序列）
    {
      name: "getLocalNews",
      description: '读取本地已抓取的快讯/公告（来自东财，cron 每20分钟更新，秒回不调外部API）。用户问"今日消息/新闻/政策/公告/有什么事件"时 MUST 优先用这个，不用 searchNewsFull。传 { hours: 2 } 读近2小时，不传读今日全部。',
      kind: "data",
      execute: async (args: any) => {
        try {
          const { getAllSince } = await import("./dataStore");
          const hours = Number(args?.hours ?? 24);
          const since = getBJDateStr(new Date(Date.now() - hours * 3600000)); // v15-1：北京时间日期（原 toISOString 本地偏移 bug）
          const { news, ann } = getAllSince(since);
          return {
            newsCount: news.length,
            annCount: ann.length,
            topNews: news.slice(0, 15).map(n => ({ title: n.title, time: n.time, sentiment: n.sentiment, stars: n.stars })),
            topAnns: ann.slice(0, 10).map(a => ({ title: a.title, name: a.stockName, time: a.time })),
          };
        } catch { return { error: "本地数据读取失败" }; }
      },
    },
    {
      name: "getStockFundDetail",
      description: '个股资金面（按代码）：主力净流入(元/占比)/5日/10日/换手/量比/现价/涨幅 —— 传 code 参数如 {"code":"600001"}',
      kind: "data",
      execute: async (args: any) => {
        try {
          const { fetchStockOne } = await import("./api");
          const d = await fetchStockOne(String(args?.code ?? ""));
          if (!d) return { error: "个股行情获取失败（代码无效？）" };
          return d;
        } catch (e) { return { error: "资金查询失败:" + String(e) }; }
      },
    },
    // ★ V13-3：妙想工具（researchQuote/researchData/researchSearch/searchNewsFull）仅在"个股深度调研"时加载
    ...(isDeepResearch ? [
      ...getResearchTools(),
      {
        // v9.64（V2-P1-1）：新闻全文搜索工具化 —— 深度调研时补充外部信息
        name: "searchNewsFull",
        description: '新闻全文搜索：按关键词拉最新消息标题/摘要/时间（回答"XX消息利好谁/有什么政策"时先调它）—— 传 keyword 参数如 {"keyword":"低空经济"}',
        kind: "data",
        execute: async (args: any) => {
          try {
            const { fetchStockNews } = await import("./api");
            const items = await fetchStockNews(String(args?.keyword ?? ""), 15);
            return items.slice(0, 15).map(n => ({
              title: n.title, time: n.time, summary: (n as any).summary ?? "",
            }));
          } catch (e) { return { error: "新闻搜索失败:" + String(e) }; }
        },
      },
    ] : []),
  ];
  const toolDefs = tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: { type: "object", properties: {}, additionalProperties: true },
  }));
  const toolByName = new Map(tools.map(t => [t.name, t]));

  const ctxSummary = [
    "当前最强主线：" + (siteContext.topMainline ?? "暂无")
      + (siteContext.topMainlineScore != null ? "（强度" + siteContext.topMainlineScore + "分）" : "")
      + (siteContext.topMainlineZtCount ? "·涨停" + siteContext.topMainlineZtCount + "只" : "")
      + (siteContext.topMainlineHeight ? "·最高" + siteContext.topMainlineHeight + "板" : ""),
    "市场情绪：" + (siteContext.sentiment ?? "?") + "（" + (siteContext.sentimentLabel ?? "数据不足") + "）",
    siteContext.marketNet != null ? "全市场主力净流入：" + fmtMoney(siteContext.marketNet) : "",
    siteContext.watchStocks ? "用户自选股：" + siteContext.watchStocks : "",
  ].filter(Boolean).join("\n");

  // V13-3（P0）：触发条件收紧为仅"个股深度调研"六个字（用户明确要求，其他问题不用妙想）
  // isDeepResearch/maxRounds 已在工具集处声明（第 44-45 行），此处不再重复
  const system = "你是这个A股实时监控终端的全站分析师助手（10年游资操盘手）。用户会问你任何关于主线/个股/资金/消息/席位/仓位的问题。\n\n"
    + "【工具使用铁律 v13-3】\n"
    + "- 默认所有问题（消息/主线/个股/资金/仓位）→ MUST 优先用本地数据工具（getLocalNews/getStockFundDetail/getAdmissionVerdict/getFundStreak 等），用已抓取的真实数据 + 你的推理来回答。\n"
    + "- 妙想工具（researchQuote/researchData/researchSearch/searchNewsFull）仅在用户消息含'个股深度调研'时可用——其他时候这些工具不存在，不要尝试调用。\n"
    + "- 本地数据工具秒回，不依赖外部 API，不会超时。\n\n"
    + "你有以下工具（自主决定调用顺序与次数，最多 " + maxRounds + " 轮；查个股时用 getStockFundDetail 传 code）：\n"
    + toolDefs.map(t => "- " + t.name + ": " + t.description).join("\n")
    + "\n\n" + RESEARCH_SYSTEM + "\n\n"
    + "规则：\n"
    + "1. 先调用 1-3 个关键工具获取真实数据（如问\"低空经济能不能上车\"→ getAdmissionVerdict/getMainlineStrength/getFundStreak；问\"某只票\"→ getStockFundDetail/detectTrap/checkExitSignal）。\n"
    + "2. 观察工具结果后再决定下一步；数据足够后直接给最终答复。\n"
    + "3. 每轮输出严格JSON之一：\n"
    + "   调用工具：{\"calls\":[{\"tool\":\"工具名\",\"args\":{...可选},\"reason\":\"为什么查它\"}]}\n"
    + "   最终答复：{\"final\":{\"reply\":\"完整答复（≤300字，必须引用≥2个工具返回的具体数字，如'主力净流入8000万/封单比40%'；先说结论再说依据）\"}}\n"
    + "4. 最多 " + maxRounds + " 轮后必须出最终答复。\n"
    + "5. 不知道/数据不足就直说，禁止编造数字。\n"
    + "6. 【多轮衔接 v9.66.1】系统会给你最近几轮对话历史。若用户说\"继续/深入查询\"：先读历史确认当前调研的标的与进度，从上次停止处继续推进（不要从头重复 Phase 0），完成剩余阶段后再评级；若历史中的标的与用户新提的标的不同，才切换新标的。";

  // v9.67：注入调研会话状态（若 AIConsole 正在调研某标的）—— 结构化上下文优先于纯文本历史
  const ctxNote = opts?.researchCtx ? researchCtxNote(opts.researchCtx) : "";
  // v9.84.2（AI大脑层 · 3.1）：大脑快照注入（服务端聚合，60s 缓存，失败静默）
  const brainNote = await fetchBrainContext().then(b => (b ? brainContextToText(b) : ""));
  const userCtx = (ctxNote ? "【调研会话状态】\n" + ctxNote + "\n\n" : "")
    + (brainNote ? brainNote + "\n\n" : "")
    + "【当前页面状态】\n" + ctxSummary + "\n\n【用户提问】" + question + "\n\n本轮请输出JSON（工具调用或最终答复）：";
  let roundHistory: string[] = [];
  let llmOk = true;
  let rateLimitedFlag = false;
  let lastReason: "rateLimited" | "timeout" | "network" | "model" | undefined;
  const calledTools = new Set<string>();

  // ============== V14-2（= V13-7 补做）：简单问题快捷直答（0 次 LLM，秒回不超时） ==============
  const q = question.trim();
  // ① 消息/新闻/快讯/公告/事件类 → 直接读本地快讯（不调 LLM，不调妙想）
  if (/消息|新闻|快讯|公告|事件|海内外|国内外/.test(q) && !q.includes("个股深度调研")) {
    try {
      const { getAllSince } = await import("./dataStore");
      let since = getBJDateStr(); // v15-1：北京时间今日（原 toISOString UTC 会偏一天）
      if (/昨天|昨日/.test(q)) { since = getBJDateStr(new Date(Date.now() - 86400000)); }
      const dm = q.match(/(\d{1,2})[.月](\d{1,2})/);
      if (dm) since = `${new Date().getFullYear()}-${String(+dm[1]).padStart(2, "0")}-${String(+dm[2]).padStart(2, "0")}`;
      const { news, ann } = getAllSince(since);
      if (news.length === 0 && ann.length === 0)
        return { reply: `${since} 暂无本地快讯/公告（cron 可能尚未抓取或非交易日）。`, toolsCalled: ["getLocalNews"], degraded: false };
      const lines = [`📅 ${since} 本地消息（快讯${news.length}·公告${ann.length}）`];
      const policy = news.filter(n => /国务院|央行|证监会|发改委|财政部/.test(n.title));
      if (policy.length) { lines.push("🏛️ 政策："); policy.slice(0, 5).forEach(n => lines.push(`  • ${n.title}`)); }
      const market = news.filter(n => !policy.includes(n)).slice(0, 10);
      if (market.length) { lines.push("📊 市场："); market.forEach(n => lines.push(`  • ${n.title}`)); }
      const strong = ann.filter(a => /业绩|中标|增持|回购|重组|获批/.test(a.title)).slice(0, 5);
      if (strong.length) { lines.push("📋 公告："); strong.forEach(a => lines.push(`  • ${a.stockName ?? ""}：${a.title}`)); }
      return { reply: lines.join("\n").slice(0, 800), toolsCalled: ["getLocalNews"], degraded: false };
    } catch { /* 快捷失败→继续 ReAct */ }
  }
  // ② 主线类 → 直接用 siteContext（当前页面状态已打包最强主线）
  if (/主线.*什么|今日主线|最强主线/.test(q) && siteContext.topMainline) {
    return { reply: `今日最强主线：${siteContext.topMainline}（强度${siteContext.topMainlineScore ?? "?"}分，涨停${siteContext.topMainlineZtCount ?? "?"}只）`, toolsCalled: ["siteContext"], degraded: false };
  }

  for (let round = 0; round < maxRounds; round++) {
    const user = round === 0 ? userCtx : (roundHistory.join("\n") + "\n\n（继续，或直接给最终答复）：");
    let r: AgentChatResult | null;
    try { r = await callAgentChat(system, user, toolDefs, { temperature: 0.2, history: opts?.history }); } catch { r = null; }
    if (!r) { llmOk = false; lastReason = "model"; break; }
    if (r.rateLimited) { llmOk = false; rateLimitedFlag = true; lastReason = "rateLimited"; break; }
    if (r.reason) { llmOk = false; lastReason = r.reason; break; }

    // ① 原生 tool_calls
    if (r.toolCalls && r.toolCalls.length > 0) {
      const roundOut: string[] = [];
      for (const tc of r.toolCalls) {
        const tool = toolByName.get(tc.name);
        if (!tool) { roundOut.push("未知工具 " + tc.name); continue; }
        calledTools.add(tc.name);
        let args: any = {};
        try { args = JSON.parse(tc.args || "{}"); } catch { /* 默认空 */ }
        try {
          const res = await tool.execute(args);
          roundOut.push(tc.name + " 返回：" + JSON.stringify(res).slice(0, 260));
        } catch { roundOut.push(tc.name + " 执行失败"); }
      }
      roundHistory.push("第" + (round + 1) + "轮调用：\n" + roundOut.join("\n"));
      continue;
    }

    // ② 手动 JSON
    const parsed = parseAIJSON<{ calls?: Array<{ tool: string; args?: object }>; final?: { reply?: string } }>(r.text);
    if (parsed?.final?.reply) {
      return { reply: String(parsed.final.reply).slice(0, 600), toolsCalled: [...calledTools], degraded: false };
    }
    if (parsed?.calls && parsed.calls.length > 0) {
      const roundOut: string[] = [];
      for (const c of parsed.calls) {
        const tool = toolByName.get(c.tool);
        if (!tool) { roundOut.push("未知工具 " + c.tool); continue; }
        calledTools.add(c.tool);
        try {
          const res = await tool.execute(c.args ?? {});
          roundOut.push(c.tool + " 返回：" + JSON.stringify(res).slice(0, 260));
        } catch { roundOut.push(c.tool + " 执行失败"); }
      }
      roundHistory.push("第" + (round + 1) + "轮调用：\n" + roundOut.join("\n"));
      continue;
    }
    roundHistory.push("（第" + (round + 1) + "轮 LLM 输出无法解析）");
  }
  // v9.67：智能降级文案 —— 按"调了几个工具"和降级原因分类，不再一刀切
  // V14-2（= V13-8 补做）：降级时提取已获取工具数据（title 字段）拼入文案，不再空白
  const toolCount = calledTools.size;
  const reason = lastReason;
  let fbData = "";
  if (roundHistory.length > 0) {
    const titles = roundHistory.join("\n").match(/"title":\s*"([^"]+)"/g);
    if (titles?.length) fbData = "\n\n📝 已获取数据参考：\n" + titles.slice(0, 8).map(t => "• " + t.replace(/"title":\s*"/, "").replace(/"$/, "")).join("\n");
  }
  let reply: string;
  if (llmOk) {
    reply = "抱歉，本轮未能给出可靠答复（AI 输出异常）。可换个问法重试，或到对应 Tab 查看详细数据。";
  } else if (rateLimitedFlag) {
    reply = `⏸ AI 配额受限（达 ${maxRounds > 5 ? "深度" : "标准"}桶上限）${toolCount > 0 ? `，本轮已成功调 ${toolCount} 个工具但最终结论未生成` : ""}。可稍后重试，或查看工具轨迹中已调用的工具结果。`;
  } else if (reason === "timeout") {
    reply = `⏸ AI 上游超时（20s 内未返回，妙想 API 经代理 127.0.0.1:7897 调用慢）${toolCount > 0 ? `，本轮已成功调 ${toolCount} 个工具但最终结论未生成` : ""}。建议重试，或临时关闭代理后再试。`;
  } else if (reason === "network") {
    reply = `⏸ AI 网络不通（无法连接到妙想 API）${toolCount > 0 ? `，本轮已成功调 ${toolCount} 个工具但最终结论未生成` : ""}。检查网络/代理后重试，或直接查看各 Tab 的实时数据。`;
  } else {
    reply = `⏸ AI 服务异常${toolCount > 0 ? `，本轮已成功调 ${toolCount} 个工具（${[...calledTools].join("/")}）但最终结论未生成` : ""}。建议稍后重试，或直接查看各 Tab 的实时数据。`;
  }
  // V14-2（V13-8）：降级时有已获取数据 → 附上（不再"AI 输出异常"空白）
  reply = fbData ? reply + fbData : reply;
  return {
    reply,
    toolsCalled: [...calledTools],
    degraded: true,
    rateLimited: rateLimitedFlag,
  };
}

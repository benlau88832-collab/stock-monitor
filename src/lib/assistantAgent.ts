// ============================================================
// v9.58（V8-8）：全局 AI 助手 —— 贯通全站的对话入口
// 用户任意提问（主线/个股/资金/消息/席位/仓位）→ ReAct 自主调全站工具 → 带数字的连贯答复
// 工具：agentTools 全套（主线级）+ getStockFundDetail(code)（个股资金，动态按代码查）
// 降级：配额受限/失败 → degraded（AIConsole 顶部显式标注 V8-10）
// ============================================================
import { getAgentTools } from "./agentTools";
import { callAgentChat, parseAIJSON, type AgentChatResult } from "./ai";
import { fmtMoney } from "./format";

export interface AssistantReply {
  reply: string;
  toolsCalled: string[];
  degraded: boolean;
  rateLimited?: boolean;
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
): Promise<AssistantReply> {
  const tools = [...getAgentTools(), {
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
  }, {
    // v9.64（V2-P1-1）：新闻全文搜索工具化 —— 用户问政策/公告/事件时，AI 可主动搜最新消息
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
  }];
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

  const system = "你是这个A股实时监控终端的全站分析师助手（10年游资操盘手）。用户会问你任何关于主线/个股/资金/消息/席位/仓位的问题。\n\n"
    + "你有以下工具（自主决定调用顺序与次数，最多 5 轮；查个股时用 getStockFundDetail 传 code）：\n"
    + toolDefs.map(t => "- " + t.name + ": " + t.description).join("\n")
    + "\n\n规则：\n"
    + "1. 先调用 1-3 个关键工具获取真实数据（如问\"低空经济能不能上车\"→ getAdmissionVerdict/getMainlineStrength/getFundStreak；问\"某只票\"→ getStockFundDetail/detectTrap/checkExitSignal）。\n"
    + "2. 观察工具结果后再决定下一步；数据足够后直接给最终答复。\n"
    + "3. 每轮输出严格JSON之一：\n"
    + "   调用工具：{\"calls\":[{\"tool\":\"工具名\",\"args\":{...可选},\"reason\":\"为什么查它\"}]}\n"
    + "   最终答复：{\"final\":{\"reply\":\"完整答复（≤300字，必须引用≥2个工具返回的具体数字，如'主力净流入8000万/封单比40%'；先说结论再说依据）\"}}\n"
    + "4. 最多 5 轮后必须出最终答复。\n"
    + "5. 不知道/数据不足就直说，禁止编造数字。";

  const userCtx = "【当前页面状态】\n" + ctxSummary + "\n\n【用户提问】" + question + "\n\n本轮请输出JSON（工具调用或最终答复）：";
  let history: string[] = [];
  let llmOk = true;
  let rateLimitedFlag = false;
  const calledTools = new Set<string>();

  for (let round = 0; round < 5; round++) {
    const user = round === 0 ? userCtx : (history.join("\n") + "\n\n（继续，或直接给最终答复）：");
    let r: AgentChatResult | null;
    try { r = await callAgentChat(system, user, toolDefs, { temperature: 0.2 }); } catch { r = null; }
    if (!r) { llmOk = false; break; }
    if (r.rateLimited) { llmOk = false; rateLimitedFlag = true; break; }

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
      history.push("第" + (round + 1) + "轮调用：\n" + roundOut.join("\n"));
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
      history.push("第" + (round + 1) + "轮调用：\n" + roundOut.join("\n"));
      continue;
    }
    history.push("（第" + (round + 1) + "轮 LLM 输出无法解析）");
  }
  return {
    reply: llmOk
      ? "抱歉，本轮未能给出可靠答复（AI 输出异常）。可换个问法重试，或到对应 Tab 查看详细数据。"
      : "⏸ AI 配额受限/服务不可用，本次未能调用全站数据（可稍后重试，或直接查看各 Tab 的实时数据）。",
    toolsCalled: [...calledTools],
    degraded: true,
    rateLimited: rateLimitedFlag,
  };
}

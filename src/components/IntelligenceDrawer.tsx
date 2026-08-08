import { useState, useEffect, useRef, useCallback } from "react";
import { getFeed, type AlertEvent } from "../lib/alertBus";
import { callAI, hasAvailableAI, hasAIOptimistic, type AIResult } from "../lib/ai";
import { loadDailyMemo } from "../lib/newsMemoStore";
import { fetchStockNews, fetchStockAnnouncements } from "../lib/api";
import { getAllSince, getAllOnDate } from "../lib/dataStore";
import { computeStats, formatStatsForPrompt } from "../lib/intelStats";
import { localDateStr, localDateStrOffset } from "../lib/format";

// ============== 聊天消息类型 ==============
interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

// ============== 日期解析器：从用户提问中提取目标日期 ==============
// 返回 { ymd: "20260730", dash: "2026-07-30" } 或 null
// 支持：昨天/前天/7.30/7月30日/7-30/7/30/20260730/2026-07-30
//
// 时区策略：直接用本地时间（CST 时区 getMonth/getDate 就是本地月日），
// 不再做 UTC↔北京时间的换算（之前的 `(8*60 - getTimezoneOffset())` 公式错算成 +16h，
// 在 CST 时区 getTimezoneOffset()=-480 → 8*60-(-480)=960min=+16h，导致"今天/昨天"漂移到下一天）
function parseQueryDate(q: string): { ymd: string; dash: string } | null {
  const now = new Date();
  const Y = now.getFullYear();
  const rel = (d: number) => {
    const ds = localDateStrOffset(d, now);
    return { ymd: ds.replace(/-/g, ""), dash: ds };
  };
  if (/昨天|昨日/.test(q)) return rel(1);
  if (/前天/.test(q)) return rel(2);
  // M.D / M月D日 / M-D / M/D（含点号分隔，适配 "7.30"）
  const m = q.match(/(\d{1,2})\s*[.月/\-]\s*(\d{1,2})\s*[日号]?/);
  if (m) {
    const mo = +m[1], da = +m[2];
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      const ds = `${Y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
      return { ymd: ds.replace(/-/g, ""), dash: ds };
    }
  }
  // YYYYMMDD
  const m3 = q.match(/(20\d{2})(\d{2})(\d{2})/);
  if (m3) return { ymd: m3[0], dash: `${m3[1]}-${m3[2]}-${m3[3]}` };
  return null;
}

// ============== 督导室专用 system prompt ==============
const SUPERVISOR_SYSTEM = `你是A股实战交易督导，具备游资与机构双视角。

回答规则：
1. 用户问什么就答什么——问主线就说主线、问新闻就列新闻、问操作就给方向
2. 用自然段落回答，像一个老练的操盘手跟搭档说话，不要复述数据标签
3. 必须基于下方【数据快照】中的真实内容回答，禁止编造任何具体数字
4. 数据缺失就明说"暂缺"，不要凑字数
5. 引用消息/公告时带标题或股票代码
6. 禁止免责声明、禁止"仅供参考"类措辞`;

// ============== 全站快照 Prompt 构建（返回 system + user 分离） ==============
// 自动识别用户提问中的日期，切换到该天的快照数据
// 目标：AI接收全站所有可用信息，基于完整数据回答任何问题
async function buildSupervisorPrompt(question: string): Promise<{ system: string; user: string }> {
  const dataParts: string[] = [];
  const now = new Date();
  // 用本地时间构建"今天"的紧凑 key（YYYYMMDD），与 ztSnapshot/dataStore 一致
  const td = localDateStr(now).replace(/-/g, "");

  // ① 日期检测
  const qd = parseQueryDate(question);
  // 修复：原 bj.toISOString().slice(0,10) 在 CST 凌晨 0-8 点会取到"昨天"
  const dateLabel = qd ? qd.dash : localDateStr(now);

  // ===== 1. 市场盘面 =====
  let sentScore = "";
  try { const s = localStorage.getItem(`sentiment:${dateLabel}`); if (s && Number(s) > 0) sentScore = `${s}分`; } catch (e) { console.warn("[intelli] op failed", e); }
  dataParts.push(`【市场盘面】情绪温度计：${sentScore || "暂缺"}`);

  // ===== 2. 市场整体行情 =====
  try {
    const { fetchIndexOverview, fetchMarketBreadth, fetchMarketTurnover, fetchMarketMainFund } = await import("../lib/api");
    const [indices, breadth, turnover, mainFund] = await Promise.allSettled([
      fetchIndexOverview(),
      fetchMarketBreadth(),
      fetchMarketTurnover(),
      fetchMarketMainFund(),
    ]);
    
    const idxStr = indices.status === "fulfilled" && indices.value.length > 0
      ? `指数：${indices.value.map(i => `${i.name}=${i.price.toFixed(2)}(${i.pct > 0 ? '+' : ''}${i.pct.toFixed(2)}%)`).join(" ")}`
      : "指数：暂缺";
    
    const brStr = breadth.status === "fulfilled"
      ? `涨跌：涨${breadth.value.up}跌${breadth.value.down}平${breadth.value.flat} 平均涨幅${breadth.value.avgPct.toFixed(2)}%`
      : "涨跌：暂缺";
    
    const toStr = turnover.status === "fulfilled" && turnover.value.available
      ? `成交额：${(turnover.value.amount / 1e8).toFixed(1)}亿元`
      : "成交额：暂缺";
    
    const fundStr = mainFund.status === "fulfilled"
      ? `主力资金：今日=${mainFund.value.mainNet > 0 ? '+' : ''}${mainFund.value.mainNet.toFixed(0)}亿 5日=${mainFund.value.mainNet5d > 0 ? '+' : ''}${mainFund.value.mainNet5d.toFixed(0)}亿 10日=${mainFund.value.mainNet10d > 0 ? '+' : ''}${mainFund.value.mainNet10d.toFixed(0)}亿`
      : "主力资金：暂缺";
    
    dataParts.push(`【市场快照】${idxStr} | ${brStr} | ${toStr} | ${fundStr}`);
  } catch { /* skip */ }

  // ===== 3. 情报台结论 =====
  try {
    const memo = loadDailyMemo(qd?.ymd ?? td);
    if (memo) {
      dataParts.push(`【情报台】阶段=${memo.cycleStage} 主线=${(memo.focusThemes ?? []).join("/")} 市场在交易=${memo.whatMarketTrades ?? "—"} 趋势=${memo.trend ?? "—"} 指引=${memo.directionAdvice ?? "—"}`);
      if (memo.rawSummary) dataParts.push(`全盘分析：${memo.rawSummary.slice(0, 500)}`);
    } else {
      dataParts.push("【情报台】暂未生成");
    }
  } catch { /* skip */ }

  // ===== 4. 板块情绪统计 =====
  try {
    const { news, ann } = qd
      ? getAllOnDate(qd.dash)
      : getAllSince(localDateStr(now));
    if (news.length || ann.length) {
      dataParts.push(`【板块情绪】${formatStatsForPrompt(computeStats(news, ann))}`);
    }
  } catch { /* skip */ }

  // ===== 5. 涨停池详细信息 =====
  try {
    const { fetchLimitPoolSummary } = await import("../lib/api");
    const limitPool = await fetchLimitPoolSummary(qd?.ymd);
    if (limitPool && limitPool.rawZTPool && limitPool.rawZTPool.length > 0) {
      const details = limitPool.rawZTPool.slice(0, 15).map((s: any) => 
        `${s.name || s.n}(${s.c})`
      ).join("/");
      dataParts.push(`【涨停池】${limitPool.limitUpCount}只涨停 ${limitPool.blastedCount}只炸板 炸板率${limitPool.blastedRate.toFixed(1)}% | 详情:${details}`);
    }
  } catch { /* skip */ }

  // ===== 6. 全市场公告 =====
  try {
    const { fetchMarketAnnouncements } = await import("../lib/api");
    const marketAnns = await fetchMarketAnnouncements(50);
    if (marketAnns.length > 0) {
      const recentAnns = marketAnns.slice(0, 10).map(a => 
        `[${a.stockCode}]${a.stockName}:${a.title}`
      ).join("; ");
      dataParts.push(`【全市场公告】${recentAnns}`);
    }
  } catch { /* skip */ }

  // ===== 7. 实时快讯 =====
  try {
    const { fetchFastNews } = await import("../lib/api");
    const fastNews = await fetchFastNews(30);
    if (fastNews.length > 0) {
      const recentNews = fastNews.slice(0, 10).map(n => 
        `${n.title}(${n.time.slice(11, 16)})`
      ).join("; ");
      dataParts.push(`【实时快讯】${recentNews}`);
    }
  } catch { /* skip */ }

  // ===== 8. 板块资金流 Top =====
  try {
    const { fetchBoardRankTopBottom } = await import("../lib/api");
    const boardRank = await fetchBoardRankTopBottom("concept", 5);
    if (boardRank?.inflow?.length > 0) {
      const topInflow = boardRank.inflow.map(b => 
        `${b.name}:净流入${b.mainNet > 0 ? '+' : ''}${b.mainNet.toFixed(0)}万`
      ).join("; ");
      dataParts.push(`【资金流入Top】${topInflow}`);
    }
    if (boardRank?.outflow?.length > 0) {
      const topOutflow = boardRank.outflow.map(b => 
        `${b.name}:净流出${Math.abs(b.mainNet).toFixed(0)}万`
      ).join("; ");
      dataParts.push(`【资金流出Top】${topOutflow}`);
    }
  } catch { /* skip */ }

  // ===== 9. 自选股详情 =====
  const codes: string[] = (() => { try { return JSON.parse(localStorage.getItem("stock_watchlist") || "[]"); } catch { return []; } })();
  if (codes.length > 0) {
    const wl: string[] = [];
    const { fetchStockOne } = await import("../lib/api");
    const quotes = await Promise.all(
      codes.slice(0, 6).map(code => fetchStockOne(code).catch(() => null))
    );
    
    for (let i = 0; i < codes.length && i < 6; i++) {
      const code = codes[i];
      try {
        const [sNews, sAnns] = await Promise.all([
          fetchStockNews(code, 3),
          fetchStockAnnouncements(code, 2)
        ]);
        const quote = quotes[i];
        
        const tag = (t: string) => /利空|下跌|减持|亏损/.test(t) ? "利空" : /利好|上涨|增持|中标|回购|预增/.test(t) ? "利好" : "中性";
        const newsItems = sNews.map(n => {
          const content = n.summary ? `${n.title} - ${n.summary.slice(0, 80)}` : n.title;
          return `[${tag(n.title + n.summary)}]${content}`;
        }).join("; ") || "无";
        const annStr = sAnns.map(a => a.title).join("; ") || "无";
        
        const quoteStr = quote 
          ? `价格=${quote.price.toFixed(2)} 涨跌=${(quote.pct * 100).toFixed(2)}% 主力=${quote.mainNet > 0 ? '+' : ''}${quote.mainNet.toFixed(0)}万`
          : "行情暂缺";
        
        wl.push(`${code} ${quote?.name || ''}: ${quoteStr} | 消息:${newsItems} | 公告:${annStr}`);
      } catch { /* skip */ }
    }
    if (wl.length > 0) {
      dataParts.push(`【自选股】${wl.join(" | ")}`);
    }
  }

  // v9.75（深化）：注入信号账本 T+1/T+5 命中率 —— 让督导能引用历史决策效果（原快照无任何历史验证数据）
  try {
    const { getSignalStats } = await import("../lib/signalLedger");
    const stats = getSignalStats().filter(s => s.count >= 3).slice(0, 8);
    if (stats.length > 0) {
      dataParts.push(`【信号历史验证】${stats.map(s => `${s.typeLabel}：${s.count}次/胜率${s.winRateT5 ?? "?"}%/均收${s.avgReturnT5 ?? "?"}%`).join(" | ")}`);
    }
  } catch { /* 账本不可用跳过 */ }

  // ===== 构建最终 Prompt =====
  // 构建 system（角色指令 + 日期提示）
  let system = SUPERVISOR_SYSTEM;
  if (qd) {
    system += `\n\n⚠️ 用户问的是【${qd.dash}】的行情/消息，请基于该日数据回答。`;
  }

  // 构建 user（数据快照 + 用户问题，明确分隔）
  const user = `【全站数据快照(${dateLabel})】
${dataParts.join("\n")}

【用户问题】
${question}`;

  return { system, user };
}

// ============== Props ==============
interface Props {
  open: boolean;
  onClose: () => void;
}

export default function IntelligenceDrawer({ open, onClose }: Props) {
  const [tab, setTab] = useState<"feeds" | "chat">("feeds");
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 刷新警报流水
  useEffect(() => {
    if (!open) return;
    setAlerts(getFeed());
    const t = setInterval(() => setAlerts(getFeed()), 5000);
    return () => clearInterval(t);
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // 滚到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // 发送消息
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: ChatMsg = { role: "user", content: text.trim(), ts: Date.now() };
    setChatHistory(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const { system, user } = await buildSupervisorPrompt(text.trim());
      const result: AIResult = await callAI("supervisor", { system, user });
      const aiMsg: ChatMsg = { role: "assistant", content: result.text, ts: Date.now() };
      setChatHistory(prev => [...prev, aiMsg]);
    } catch {
      setChatHistory(prev => [...prev, { role: "assistant", content: "AI暂时不可用，请检查 API Key 配置", ts: Date.now() }]);
    } finally { setLoading(false); }
  }, [loading]);

  // 一键向AI核实
  const askAbout = useCallback((text: string) => {
    setTab("chat");
    const question = `帮我核实分析：${text}`;
    setInput(question);
    // 自动发送
    setTimeout(() => sendMessage(question), 100);
  }, [sendMessage]);

  // v9.26.9：AI 可用性（浏览器 Key 或服务端中转均可），不再误判"未配置 Key"
  const [aiAvailable, setAiAvailable] = useState<boolean>(hasAIOptimistic());
  useEffect(() => { hasAvailableAI().then(setAiAvailable); }, []);
  const noAI = !aiAvailable;

  return (
    <>
      {/* 遮罩层 */}
      {open && (
        <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
      )}

      {/* 抽屉 */}
      <div className={`fixed top-0 right-0 h-full w-[400px] max-w-[90vw] bg-[#0b0f1a] border-l border-white/10 shadow-2xl z-[61] transition-transform duration-300 ease-in-out ${
        open ? "translate-x-0" : "translate-x-full"
      }`}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-sm font-bold text-violet-300">💬 AI交易督导</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-lg">✕</button>
        </div>

        {/* Tab 切换 */}
        <div className="flex border-b border-white/10">
          <button onClick={() => setTab("feeds")}
            className={`flex-1 py-2 text-xs font-semibold ${tab === "feeds" ? "bg-white/5 text-amber-300 border-b-2 border-amber-400" : "text-slate-400"}`}>
            📋 警报 & 公告时间线
          </button>
          <button onClick={() => setTab("chat")}
            className={`flex-1 py-2 text-xs font-semibold ${tab === "chat" ? "bg-white/5 text-violet-300 border-b-2 border-violet-400" : "text-slate-400"}`}>
            🤖 作战督导室
          </button>
        </div>

        {/* Tab A: 警报 & 公告时间线 */}
        {tab === "feeds" && (
          <div className="flex-1 overflow-y-auto p-3 space-y-1" style={{ height: "calc(100vh - 100px)" }}>
            {alerts.length === 0 && (
              <div className="text-[11px] text-slate-600 text-center py-4">暂无警报与事件</div>
            )}
            {alerts.slice(0, 30).map((e, i) => {
              const sevColor = e.severity === "critical" ? "text-rose-400 border-rose-500/30" : e.severity === "warning" ? "text-amber-300 border-amber-500/30" : "text-slate-400 border-white/10";
              return (
                <div key={i} className={`rounded-lg border p-2 text-[11px] ${sevColor} bg-black/20`}>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">{new Date(e.ts).toTimeString().slice(0, 5)}</span>
                    <button onClick={() => askAbout(e.message)}
                      className="rounded px-1.5 py-0.5 text-[10px] bg-violet-500/20 text-violet-300 hover:bg-violet-500/30">
                      👉 向AI核实
                    </button>
                  </div>
                  <div className="mt-0.5">{e.message}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Tab B: 作战督导会话 */}
        {tab === "chat" && (
          <div className="flex flex-col" style={{ height: "calc(100vh - 100px)" }}>
            {/* AI 不可用提示（v9.26.9：文案准确） */}
            {noAI && (
              <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-300">
                ⚠️ AI 暂不可用：浏览器未填 Key 且服务端 AI 中转未启用（检查 ⚙️ 设置 或 server/.env 的 AI_API_KEY）
              </div>
            )}

            {/* 消息区 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 [scrollbar-width:thin]">
              {chatHistory.length === 0 && (
                <div className="text-[11px] text-slate-600 text-center py-8">
                  基于你的持仓标的与主线记忆，随时提问<br/>
                  <span className="text-slate-500">例：「半导体明天还能追吗？」「7.30怎么样」「对昨天做个总结」</span>
                </div>
              )}
              {chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`rounded-lg px-3 py-2 max-w-[85%] text-[11px] leading-relaxed ${
                    msg.role === "user"
                      ? "bg-violet-500/20 text-violet-200"
                      : "bg-white/5 text-slate-300 border border-white/10"
                  }`}>
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                    <div className="text-xs text-slate-600 mt-1">
                      {new Date(msg.ts).toTimeString().slice(0, 5)}
                    </div>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-lg px-3 py-2 bg-white/5 text-[11px] text-slate-400 animate-pulse">
                    AI 思考中…
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* 输入区 */}
            <div className="border-t border-white/10 p-3">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                  placeholder="输入问题（支持「昨天/7.30/7月28日」自动识别日期）…"
                  disabled={noAI}
                  className="flex-1 rounded bg-black/30 border border-white/10 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-violet-400/50 disabled:opacity-40"
                />
                <button onClick={() => sendMessage(input)} disabled={loading || noAI || !input.trim()}
                  className="rounded px-3 py-2 text-xs bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 disabled:opacity-40">
                  发送
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

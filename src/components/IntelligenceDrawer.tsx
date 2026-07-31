import { useState, useEffect, useRef, useCallback } from "react";
import { getFeed, type AlertEvent } from "../lib/alertBus";
import { callAI, getApiKey, type AIResult } from "../lib/ai";
import { loadDailyMemo } from "../lib/newsMemoStore";
import { fetchStockNews, fetchStockAnnouncements } from "../lib/api";
import { getAllSince, getAllOnDate } from "../lib/dataStore";
import { computeStats, formatStatsForPrompt } from "../lib/intelStats";

// ============== 聊天消息类型 ==============
interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

// ============== 日期解析器：从用户提问中提取目标日期 ==============
// 返回 { ymd: "20260730", dash: "2026-07-30" } 或 null
// 支持：昨天/前天/7.30/7月30日/7-30/7/30/20260730/2026-07-30
function parseQueryDate(q: string): { ymd: string; dash: string } | null {
  const now = new Date();
  const bj = new Date(now.getTime() + (8 * 60 - now.getTimezoneOffset()) * 60000);
  const Y = bj.getFullYear();
  const rel = (d: number) => {
    const x = new Date(bj); x.setDate(x.getDate() - d);
    const ds = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
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

// ============== 全站快照式 Prompt（覆盖市场/情报/板块/涨停/自选，禁编造） ==============
// 自动识别用户提问中的日期，切换到该天的快照数据
async function buildSupervisorPrompt(question: string): Promise<string> {
  const parts: string[] = [];
  const now = new Date();
  const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  const td = `${bj.getFullYear()}${String(bj.getMonth() + 1).padStart(2, "0")}${String(bj.getDate()).padStart(2, "0")}`;

  // ① 日期检测
  const qd = parseQueryDate(question);

  // 1. 市场盘面（情绪分——按日期读取）
  const sentDate = qd ? qd.dash : bj.toISOString().slice(0, 10);
  let sentScore = "";
  try { const s = localStorage.getItem(`sentiment:${sentDate}`); if (s && Number(s) > 0) sentScore = `${s}分`; } catch {}
  parts.push(`【市场盘面】情绪${sentScore || "暂缺"}`);

  // 2. 情报台结论（识别到日期→取该日 memo，否则取今日）
  try {
    const memo = loadDailyMemo(qd?.ymd ?? td);
    parts.push(memo
      ? `【情报台结论${qd ? "(" + qd.dash + ")" : ""}】阶段:${memo.cycleStage} 主线:${(memo.focusThemes ?? []).join("/")} | 交易:${memo.whatMarketTrades ?? "—"} | 趋势:${memo.trend ?? "—"} | 指引:${memo.directionAdvice ?? "—"}`
      : "【情报台结论】暂未生成");
  } catch { /* skip */ }

  // 3. 板块情绪统计（识别到日期→精确取该日，否则取今日至今）
  try {
    const { news, ann } = qd
      ? getAllOnDate(qd.dash)
      : getAllSince(new Date().toISOString().slice(0, 10));
    if (news.length || ann.length) {
      parts.push(formatStatsForPrompt(computeStats(news, ann)));
    } else {
      parts.push("【板块统计】该日期无存储数据");
    }
  } catch { /* skip */ }

  // 4. 涨停池快照（历史日期也可读取）
  try {
    const ztKey = `ztpool:${qd?.ymd ?? td}`;
    const ztRaw = localStorage.getItem(ztKey);
    if (ztRaw) {
      const ztData = JSON.parse(ztRaw);
      if (Array.isArray(ztData) && ztData.length > 0) {
        const names = ztData.slice(0, 8).map((s: any) => s.name || s.n || "").filter(Boolean).join("/");
        parts.push(`【涨停池快照】${ztData.length}只涨停 含:${names}`);
      }
    }
  } catch { /* skip */ }

  // 5. 自选股真实数据（识别到日期时跳过，专注该日市场总结）
  if (!qd) {
    const codes: string[] = (() => { try { return JSON.parse(localStorage.getItem("stock_watchlist") || "[]"); } catch { return []; } })();
    const wl: string[] = [];
    for (const code of codes.slice(0, 10)) {
      try {
        const [sNews, sAnns] = await Promise.all([fetchStockNews(code, 4), fetchStockAnnouncements(code, 3)]);
        const tag = (t: string) => /利空|下跌|减持|亏损/.test(t) ? "利空" : /利好|上涨|增持|中标|回购|预增/.test(t) ? "利好" : "中性";
        wl.push(`${code}: 新闻${sNews.map(n => `[${tag(n.title + n.summary)}]${n.title}`).join(";") || "无"} | 公告${sAnns.map(a => a.title).join(";") || "无"}`);
      } catch { wl.push(`${code}: 获取失败`); }
    }
    parts.push("【自选股真实消息】\n" + (wl.join("\n") || "暂无自选股"));
  }

  return `你是A股交易督导。严格规则：只基于下面【全站快照】的真实数据回答；任何字段缺失就明说"暂缺/暂无"，严禁编造订单数、毛利率、营收百分比等任何具体数字；引用必须带板块名/股票代码/标题。${qd ? `\n注意：用户问的是【${qd.dash}】的消息面，请基于该日板块统计与情报台结论做总结，不要纠缠自选股实时数据。` : ""}

${parts.join("\n")}

【用户提问】${question}`;
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
      const prompt = await buildSupervisorPrompt(text.trim());
      const result: AIResult = await callAI("stockJudge", { prompt });
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

  const noKey = !getApiKey();

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
            {/* 无 Key 提示 */}
            {noKey && (
              <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-300">
                请在右上角 ⚙️ 设置配置 API Key 后使用督导会话
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
                    <div className="text-[9px] text-slate-600 mt-1">
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
                  disabled={noKey}
                  className="flex-1 rounded bg-black/30 border border-white/10 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-violet-400/50 disabled:opacity-40"
                />
                <button onClick={() => sendMessage(input)} disabled={loading || noKey || !input.trim()}
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

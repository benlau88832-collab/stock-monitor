// ============================================================
// v9.58（V8-8）：全局 AI 助手 —— 右下角悬浮对话窗（所有 Tab 可见）
// 用户提问 → runAssistantAgent 全站 ReAct → 显示工具轨迹 + 带数字答复
// V8-10：降级时顶部显式"⏸ 本次为规则结果（AI 配额受限）"，绝不假装 AI
// v9.67：调研会话状态 researchCtx —— 结构化上下文（标的/进度/已收集数据）持久化，
//   每轮注入 LLM + 对话历史持久化 —— "像真人对话一样"记住上下文，刷新不丢
// ============================================================
import { useState, useRef, useEffect } from "react";
import { runAssistantAgent, type AssistantSiteContext } from "../lib/assistantAgent";
import {
  loadResearchCtx, saveResearchCtx, updateResearchCtxAfterReply,
  extractStockCode, isNewResearchRequest, isContinueResearch,
  type ResearchCtx,
} from "../lib/researchTools";

interface Msg {
  role: "user" | "ai";
  text: string;
  tools?: string[];
  degraded?: boolean;
}

const MSGS_KEY = "ai_console_msgs";

function loadMsgs(): Msg[] {
  try {
    const raw = localStorage.getItem(MSGS_KEY);
    return raw ? JSON.parse(raw) as Msg[] : [];
  } catch { return []; }
}

export default function AIConsole({ siteContext }: { siteContext: AssistantSiteContext }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>(loadMsgs);
  const [researchCtx, setResearchCtx] = useState<ResearchCtx | null>(loadResearchCtx);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // 对话历史持久化（刷新不丢）
  useEffect(() => {
    try { localStorage.setItem(MSGS_KEY, JSON.stringify(msgs.slice(-30))); } catch { /* 静默 */ }
  }, [msgs]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs, open]);

  const ask = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");

    // v9.67：维护调研会话状态 —— 新调研(带代码)开新会话；继续沿用；换代码切换
    let ctx = researchCtx;
    if (isNewResearchRequest(q)) {
      const code = extractStockCode(q)!;
      const oldName = ctx?.code === code ? ctx.name : "";
      ctx = { code, name: oldName || code, phase: 0, collected: [], conclusion: "", updatedAt: Date.now() };
      saveResearchCtx(ctx);
      setResearchCtx(ctx);
    } else if (isContinueResearch(q) && ctx) {
      // 沿用当前会话（不重置）
    } else if (extractStockCode(q)) {
      // 新提代码但非调研指令 → 若有正在调研的会话且代码不同 → 切换（保持历史可追溯）
      const code = extractStockCode(q)!;
      if (ctx && ctx.code !== code) {
        ctx = { code, name: code, phase: 0, collected: ctx.collected.slice(-3), conclusion: "", updatedAt: Date.now() };
        saveResearchCtx(ctx);
        setResearchCtx(ctx);
      }
    }

    setMsgs(m => [...m, { role: "user", text: q }]);
    setBusy(true);
    setMsgs(m => [...m, { role: "ai", text: "🔍 正在调全站数据调研…" }]);
    try {
      // 最近对话历史（清洗工具轨迹/系统标记）
      const history = msgs
        .filter(m => m.role === "user" || (m.role === "ai" && !m.text.startsWith("🔍")))
        .slice(-8)
        .map(m => ({ role: m.role === "user" ? "user" as const : "assistant" as const, content: m.text.slice(0, 800) }));
      const r = await runAssistantAgent(q, siteContext, { history, researchCtx: ctx });
      // 回复后推进会话状态
      const nextCtx = updateResearchCtxAfterReply(ctx, r.reply, r.toolsCalled);
      if (nextCtx) setResearchCtx(nextCtx);
      setMsgs(m => m.slice(0, -1).concat({
        role: "ai",
        text: r.reply,
        tools: r.toolsCalled,
        degraded: r.degraded,
      }));
    } catch {
      setMsgs(m => m.slice(0, -1).concat({ role: "ai", text: "⚠ 助手调用失败，请稍后重试", degraded: true }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* 右下角悬浮按钮（所有 Tab 可见） */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-rose-500 text-xl text-white shadow-lg shadow-rose-500/30 hover:scale-105 transition"
        title="全局 AI 助手（问主线/个股/资金/席位）"
      >
        🤖
        {!open && msgs.length === 0 && (
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
        )}
      </button>

      {open && (
        // v9.63（V9-P2）：移动端适配 —— 固定 380px 在手机上几乎占满屏，加 max-w 收窄
        <div className="fixed bottom-20 right-5 z-50 flex h-[480px] w-[380px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-violet-500/30 bg-[#0b0f1a]/95 shadow-2xl shadow-black/50 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-violet-300">🤖 全站 AI 助手</span>
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-500">可问主线/个股/资金/席位/消息</span>
            </div>
            <button onClick={() => setOpen(false)} className="rounded px-1.5 py-0.5 text-slate-500 hover:text-slate-300">✕</button>
          </div>

          {/* 消息区 */}
          <div ref={bodyRef} className="flex-1 space-y-2 overflow-y-auto p-3">
            {msgs.length === 0 && (
              <div className="text-[11px] text-slate-500 space-y-1">
                <div>试试点这些：</div>
                <div className="rounded bg-white/5 px-2 py-1 text-slate-400">"今天最强主线能不能上车？龙头是谁？资金多少？"</div>
                <div className="rounded bg-white/5 px-2 py-1 text-slate-400">"600xxx 这只票有主力资金吗？有席位加持吗？"</div>
                <div className="rounded bg-white/5 px-2 py-1 text-slate-400">"现在的市场情绪和仓位建议？"</div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`text-xs ${m.role === "user" ? "text-right" : "text-left"}`}>
                {m.role === "ai" && m.degraded && (
                  <div className="mb-1 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold text-rose-300">
                    ⏸ 本次降级回复（非 AI，详见下方说明）
                  </div>
                )}
                {m.role === "ai" && m.tools && m.tools.length > 0 && (
                  <div className="mb-1 text-[9px] text-slate-600">🔍 已调工具：{m.tools.join(" / ")}{m.degraded && m.tools.length > 0 ? "（部分结果可用）" : ""}</div>
                )}
                <div className={`inline-block max-w-[92%] whitespace-pre-wrap rounded-xl px-2.5 py-1.5 text-left ${
                  m.role === "user" ? "bg-violet-500/20 text-violet-100" : "bg-white/5 text-slate-200"
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
            {busy && <div className="text-[10px] text-slate-600">助手思考中…</div>}
          </div>

          {/* 输入区 */}
          <div className="flex items-center gap-1.5 border-t border-white/10 p-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") ask(); }}
              placeholder="问：主线/个股/资金/席位…"
              className="flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-violet-500/50"
            />
            <button
              onClick={ask}
              disabled={busy || !input.trim()}
              className="rounded-lg bg-violet-500/25 px-3 py-1.5 text-xs font-bold text-violet-200 hover:bg-violet-500/35 disabled:opacity-40"
            >
              发送
            </button>
          </div>
        </div>
      )}
    </>
  );
}

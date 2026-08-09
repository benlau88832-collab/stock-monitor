// ============================================================
// v9.58（V8-8）：全局 AI 助手 —— 右下角悬浮对话窗（所有 Tab 可见）
// 用户提问 → runAssistantAgent 全站 ReAct → 显示工具轨迹 + 带数字答复
// V8-10：降级时顶部显式"⏸ 本次为规则结果（AI 配额受限）"，绝不假装 AI
// v9.67：调研会话状态 researchCtx —— 结构化上下文（标的/进度/已收集数据）持久化，
//   每轮注入 LLM + 对话历史持久化 —— "像真人对话一样"记住上下文，刷新不丢
// ============================================================
import { useState, useRef, useEffect } from "react";
import { apiFetch } from "../lib/cloudStore";
import { runAssistantAgent, isSimpleQuestion, buildQuickSystem, type AssistantSiteContext } from "../lib/assistantAgent";
import { streamChat } from "../lib/ai";
import {
  loadResearchCtx, saveResearchCtx, updateResearchCtxAfterReply,
  extractStockCode, isNewResearchRequest, isContinueResearch,
  type ResearchCtx,
} from "../lib/researchTools";
// v9.84.2（AI大脑层 · 3.3）：对话结论回写 —— 个股裁决→雷达旁标，动作判断→决策审计
import { digestConsoleReply } from "../lib/consoleDigest";

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
  // v9.81（性能）：打字机渐显期间跳过对话历史持久化（打字中每帧全量 JSON 序列化 → 结束落盘一次）
  const typingRef = useRef(false);

  // 对话历史持久化（刷新不丢）
  useEffect(() => {
    if (typingRef.current) return;
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

      // v9.84.2（AI大脑层 · 3.4）：简单问答 → 真 SSE 流式（逐字渲染，无工具轮）；
      // 失败（非本地/上游异常）→ 静默回退 ReAct 完整链路
      if (isSimpleQuestion(q)) {
        try {
          const system = await buildQuickSystem(siteContext);
          typingRef.current = true; // 流式期间跳过对话历史持久化（每帧 setState 不落盘）
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 60000); // 前端兜底：上游 45s + 缓冲
          const streamed = await streamChat(
            { system, user: q, maxTokens: 2000 },
            (delta) => {
              // 增量追加到当前最后一条 ai 消息
              setMsgs(m => {
                const last = m[m.length - 1];
                if (!last || last.role !== "ai") return [...m, { role: "ai", text: delta }];
                return [...m.slice(0, -1), { ...last, text: last.text + delta }];
              });
            },
            ctrl.signal,
          );
          clearTimeout(t);
          typingRef.current = false;
          // v9.85.0（P1-6）：仅完整成功（收到 [DONE] 且无错误）才作为正常答复；
          // 中途错误/断流 → 删除部分渲染文本并回退 ReAct（部分结论不得回写雷达/决策审计）
          if (streamed && streamed.ok) {
            // 完整文本落一次盘（打字机持久化由 msgs effect 处理）
            try { digestConsoleReply(streamed.text, [], siteContext.topMainline); } catch { /* 静默 */ }
            setBusy(false);
            return;
          }
          if (streamed && !streamed.ok && streamed.text) {
            // 清除已渲染的部分文本（错误流不应残留半截答案）
            setMsgs(m => m.filter(x => x.text !== streamed.text || x.role !== "ai"));
          }
        } catch { /* 回退 ReAct */ } finally { typingRef.current = false; }
      }

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
        // v10-7（P2）：调研完成（Phase 4 有结论）→ 自动落库 research_reports（选股清单可显示"🔬 深度调研"）
        if (nextCtx && nextCtx.phase >= 4 && nextCtx.conclusion && !r.degraded) {
          try {
            await apiFetch("/api/research/report", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                code: nextCtx.code,
                name: nextCtx.name,
                phase: 4,
                summary_json: { conclusion: nextCtx.conclusion, collected: nextCtx.collected.slice(-5) },
                full_text: nextCtx.conclusion,
              }),
            }).catch(() => {});
          } catch { /* 落库失败不阻塞对话 */ }
        }
        // v9.80（A8-06 改进）：最终答复打字机渐显（视觉流式 —— ReAct 多轮工具调用无法真正 SSE，
        // 但答复"逐字出现"消除"等待 20s 无反馈"的焦虑；降级回复同样渐显但保留 degraded 标）
        const finalText = r.reply || "（空回复）";
        // v9.84.2（AI大脑层 · 3.3）：对话结论回写（个股裁决→雷达旁标 / 动作判断→决策审计）
        try { digestConsoleReply(finalText, r.toolsCalled, siteContext.topMainline); } catch { /* 回写失败不阻塞 */ }
        setMsgs(m => m.slice(0, -1).concat({ role: "ai", text: "", tools: r.toolsCalled, degraded: r.degraded }));
        // v9.81（性能）：打字机 8ms→40ms、每帧 2-4→4-7 字符（整体速度不变，主线程 setState/重渲染频率降 5 倍）
        const full = finalText;
        let idx = 0;
        typingRef.current = true;
        await new Promise<void>(resolve => {
          const tick = () => {
            idx = Math.min(full.length, idx + 4 + Math.floor(Math.random() * 4));
            // 最后一帧恢复持久化 → 完整文本落盘一次
            if (idx >= full.length) typingRef.current = false;
            setMsgs(m => {
              const last = m[m.length - 1];
              if (!last || last.role !== "ai") return m;
              return [...m.slice(0, -1), { ...last, text: full.slice(0, idx) }];
            });
            if (idx >= full.length) resolve();
            else setTimeout(tick, 40);
          };
          tick();
        });
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
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-slate-500">可问主线/个股/资金/席位/消息</span>
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
                  <div className="mb-1 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-xs font-bold text-rose-300">
                    ⏸ 本次降级回复（非 AI，详见下方说明）
                  </div>
                )}
                {m.role === "ai" && m.tools && m.tools.length > 0 && (
                  <div className="mb-1 text-xs text-slate-600">🔍 已调工具：{m.tools.join(" / ")}{m.degraded && m.tools.length > 0 ? "（部分结果可用）" : ""}</div>
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

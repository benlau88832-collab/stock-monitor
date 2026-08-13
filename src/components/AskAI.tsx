// ============================================================
// v9.92.0（AI 贯穿全局·模块内问 AI 入口）：AskAI 组件
// 任意卡片（个股决策卡/主题作战卡/新闻卡）挂一个 —— 点击展开提问框，
// 携带现场上下文（模块数据 + 全局页面/个股感知）→ runAssistantAgent 同引擎
// （ReAct + PG 工具组 + 证据门）→ 结果就地显示，不跳窗。
// 解决："AI 结果调了看不到 / 想细问某模块却没入口"
// ============================================================
import { useState } from "react";
import { runAssistantAgent, type AssistantSiteContext } from "../lib/assistantAgent";
import { getUiContext } from "../lib/uiContext";

interface AskAIProps {
  /** 模块现场上下文（如"主题：光刻胶 · 支撑新闻：…"）—— 注入后 AI 有现场数据可答 */
  context?: string;
  /** 关联个股（快捷注入 currentStock，AI 自动知道问的是谁） */
  code?: string;
  name?: string;
  placeholder?: string;
  /** 紧凑模式（行内小按钮，适合卡片行） */
  compact?: boolean;
}

interface AskResult {
  text: string;
  tools: string[];
  degraded: boolean;
  source?: "data" | "rule" | "ai";
  /** v9.99.1（批次 5-2）：失败阶段（assistantAgent.stage 透传）—— 展示"失败发生在哪一步" */
  stage?: "llm-call" | "timeout" | "network" | "rate-limit" | "parse";
}

// v9.99.1（批次 5-2）：阶段 → 人类可读文案（crewai {success,error,stage} 对照）
const STAGE_LABEL: Record<string, string> = {
  "llm-call": "LLM 调用失败",
  timeout: "上游超时（90s）",
  network: "网络不通",
  "rate-limit": "配额受限",
  parse: "LLM 输出解析失败",
};

export default function AskAI({ context, code, name, placeholder, compact = false }: AskAIProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);

  const ask = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setBusy(true);
    setResult(null);
    // v9.137.0（审查 P2-11 修复）：模块级问 AI 时登记当前个股到全局 UI 上下文 ——
    //   原 setCurrentStock 仅 StockWatchlist 一处写入，龙虎榜/消息面等模块的 AI 上下文
    //   感知缺个股视角（注释宣称的"龙头点击/龙虎榜行点击"登记从未实现）
    try {
      if (code) {
        const { setCurrentStock } = await import("../lib/uiContext");
        setCurrentStock(code, name ?? code);
      }
    } catch { /* 上下文登记失败不影响提问 */ }
    try {
      // v9.92.0：上下文 = 全局登记（页面/个股）+ 模块现场注入
      const ui = getUiContext();
      const siteCtx: AssistantSiteContext = {
        ...ui,
        currentStock: code ? { code, name: name ?? code } : (ui.currentStock ?? null),
      };
      const fullQ = context ? `【现场上下文】\n${context}\n\n【问题】${q}` : q;
      const r = await runAssistantAgent(fullQ, siteCtx);
      setResult({ text: r.reply, tools: r.toolsCalled, degraded: r.degraded, source: r.source, stage: r.stage });
    } catch {
      setResult({ text: "⚠ 助手调用失败，请稍后重试", tools: [], degraded: true });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={e => { e.stopPropagation(); setOpen(true); }} // v9.92.1：防嵌套 <a>（新闻卡）冒泡跳转
        className={`shrink-0 rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-bold text-violet-300 hover:bg-violet-500/20 transition ${compact ? "" : "px-2 py-1 text-xs"}`}
        title="问 AI（携带当前模块上下文，就地回答）"
      >
        🤖 问AI
      </button>
    );
  }

  return (
    <div className={`rounded border border-violet-500/25 bg-violet-500/5 p-2 ${compact ? "text-[11px]" : "text-xs"}`}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") ask(); }}
          placeholder={placeholder ?? "问：这条消息利好谁？为什么涨？风险在哪？"}
          className="min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none focus:border-violet-500/50"
          autoFocus
        />
        <button
          onClick={ask}
          disabled={busy || !input.trim()}
          className="shrink-0 rounded bg-violet-500/25 px-2 py-1 text-xs font-bold text-violet-200 hover:bg-violet-500/35 disabled:opacity-40"
        >
          {busy ? "…" : "提问"}
        </button>
        <button
          onClick={() => { setOpen(false); setResult(null); setInput(""); }}
          className="shrink-0 rounded px-1.5 py-1 text-slate-500 hover:text-slate-300"
          title="收起"
        >✕</button>
      </div>
      {busy && <div className="text-[10px] text-slate-500">🔍 正在调全站数据调研…</div>}
      {result && (
        <div className="space-y-1">
          {result.degraded && (
            <div className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
              ⏸ 本次降级回复（非 AI）
              {result.stage && <span className="ml-1 text-rose-300/70">· 失败阶段：{STAGE_LABEL[result.stage] ?? result.stage}</span>}
            </div>
          )}
          {!result.degraded && result.source === "data" && (
            <div className="text-[10px] text-sky-400/70">📊 本地数据直出（未调 AI）</div>
          )}
          {result.tools.length > 0 && (
            <div className="text-[10px] text-slate-600">🔍 已调工具：{result.tools.join(" / ")}</div>
          )}
          <div className="whitespace-pre-wrap rounded bg-white/5 px-2 py-1.5 text-slate-200">{result.text}</div>
        </div>
      )}
    </div>
  );
}

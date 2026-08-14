// v9.143.0 决策动作面板：加盯盘/录逻辑/纸上确认/真实成交全部先确认后落库
import { useState } from "react";
import { BookOpen, Check, Save, Target, Wallet, X } from "lucide-react";
import { apiFetch } from "../lib/cloudStore";
import { buildPost, savePost } from "../lib/decisionPost";
import type { PortfolioLogicInput, PortfolioTradeInput } from "../hooks/usePortfolio";

interface Props {
  code: string;
  name: string;
  price: number | null;
  defaultThesis?: string;
  confidenceAtPost?: number | null;
  addTrade: (input: PortfolioTradeInput) => Promise<any>;
  saveLogic: (input: PortfolioLogicInput) => Promise<any>;
}

type ActionMode = "watch" | "logic" | "paper" | "real";

function num(v: string): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const inputCls = "w-full rounded bg-black/30 px-2 py-1 text-[11px] text-slate-200 border border-white/10 outline-none";
const labelCls = "text-[10px] text-slate-500";

export default function DecisionActionPanel({ code, name, price, defaultThesis = "", confidenceAtPost = null, addTrade, saveLogic }: Props) {
  const [mode, setMode] = useState<ActionMode | null>(null);
  const [thesis, setThesis] = useState(defaultThesis);
  const [breakLine, setBreakLine] = useState(price != null ? String(Math.round(price * 0.95 * 100) / 100) : "");
  const [board, setBoard] = useState("");
  const [catalysts, setCatalysts] = useState("");
  const [invalidation, setInvalidation] = useState("");
  const [reviewCycle, setReviewCycle] = useState("20");
  const [tradePrice, setTradePrice] = useState(price != null ? String(price) : "");
  const [qty, setQty] = useState("100");
  const [buyLow, setBuyLow] = useState(price != null ? String(Math.round(price * 0.98 * 100) / 100) : "");
  const [buyHigh, setBuyHigh] = useState(price != null ? String(Math.round(price * 1.02 * 100) / 100) : "");
  const [stopLoss, setStopLoss] = useState(price != null ? String(Math.round(price * 0.95 * 100) / 100) : "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const reset = () => {
    setMode(null);
    setThesis(defaultThesis);
    setBreakLine(price != null ? String(Math.round(price * 0.95 * 100) / 100) : "");
    setBoard("");
    setCatalysts("");
    setInvalidation("");
    setReviewCycle("20");
    setTradePrice(price != null ? String(price) : "");
    setQty("100");
    setBuyLow(price != null ? String(Math.round(price * 0.98 * 100) / 100) : "");
    setBuyHigh(price != null ? String(Math.round(price * 1.02 * 100) / 100) : "");
    setStopLoss(price != null ? String(Math.round(price * 0.95 * 100) / 100) : "");
    setNotes("");
    setMsg("");
    setErr("");
  };

  const submit = async () => {
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      if (mode === "watch") {
        const low = num(buyLow);
        const high = num(buyHigh);
        const stop = num(stopLoss);
        if (!low || !high || low <= 0 || high <= low || !stop || stop <= 0) throw new Error("请填写有效的买入区/止损价");
        const r = await apiFetch("/api/watch/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, name, buy_low: low, buy_high: high, stop_loss: stop, trigger_pct: 5, status: "active", note: "决策动作面板" }),
        });
        if (!r.ok) throw new Error("加盯盘失败");
        setMsg("已加入盯盘");
      }

      if (mode === "logic") {
        if (!thesis.trim()) throw new Error("请填写买入逻辑");
        const catalystList = catalysts.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        await saveLogic({
          code,
          name,
          thesis: thesis.trim(),
          catalysts: catalystList.map((desc) => ({ kind: "其他" as const, desc, dueDate: null, status: "待验证" as const })),
          breakLine: num(breakLine),
          board: board.trim() || null,
          invalidationConditions: invalidation.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean),
          reviewCycleDays: Math.max(1, Math.min(365, Math.round(Number(reviewCycle) || 20))),
          status: "验证中",
        });
        setMsg("已录逻辑台账");
      }

      if (mode === "paper" || mode === "real") {
        const p = num(tradePrice);
        const q = Math.round(Number(qty));
        if (!p || p <= 0 || !Number.isFinite(q) || q <= 0) throw new Error("请填写有效价格和数量");
        const simulated = mode === "paper";
        const post = buildPost({
          code,
          mainline: null,
          humanAction: "confirm",
          confidenceAtPost,
          priceAtPost: p,
          notes: `${simulated ? "纸上确认" : "真实成交"} ${notes}`.trim(),
          simulated,
        });
        await savePost(post);
        await saveLogic({
          code,
          name,
          thesis: thesis.trim() || defaultThesis || "决策确认",
          catalysts: catalysts.split(/[,，]/).map((s) => s.trim()).filter(Boolean).map((desc) => ({ kind: "其他" as const, desc, dueDate: null, status: "待验证" as const })),
          breakLine: num(breakLine),
          board: board.trim() || null,
          invalidationConditions: invalidation.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean),
          reviewCycleDays: Math.max(1, Math.min(365, Math.round(Number(reviewCycle) || 20))),
          status: "验证中",
          decisionRef: post.ticketId,
          simulated,
        });
        await addTrade({
          code,
          name,
          action: "buy",
          price: p,
          quantity: q,
          cost: p,
          decisionPostRef: post.ticketId,
          simulated,
          notes: post.notes,
        });
        setMsg(mode === "paper" ? "纸上确认已记录" : "真实成交已记录");
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      {!mode ? (
        <div className="grid grid-cols-2 gap-1">
          <button onClick={() => setMode("watch")} className="inline-flex items-center justify-center gap-1 rounded bg-sky-500/15 px-2 py-1 text-[10px] font-bold text-sky-300 hover:bg-sky-500/30"><Target className="h-3 w-3" /> 加盯盘</button>
          <button onClick={() => setMode("logic")} className="inline-flex items-center justify-center gap-1 rounded bg-teal-500/15 px-2 py-1 text-[10px] font-bold text-teal-300 hover:bg-teal-500/30"><BookOpen className="h-3 w-3" /> 录逻辑</button>
          <button onClick={() => setMode("paper")} className="inline-flex items-center justify-center gap-1 rounded bg-violet-500/15 px-2 py-1 text-[10px] font-bold text-violet-300 hover:bg-violet-500/30"><Check className="h-3 w-3" /> 纸上确认</button>
          <button onClick={() => setMode("real")} className="inline-flex items-center justify-center gap-1 rounded bg-emerald-500/15 px-2 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/30"><Wallet className="h-3 w-3" /> 记真实成交</button>
        </div>
      ) : (
        <div className="rounded border border-white/10 bg-black/20 p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-300">
              {mode === "watch" ? "加盯盘" : mode === "logic" ? "录买入逻辑" : mode === "paper" ? "纸上确认" : "记真实成交"}
            </span>
            <button onClick={reset} className="rounded p-0.5 text-slate-500 hover:bg-white/10"><X className="h-3 w-3" /></button>
          </div>
          {mode === "watch" && (
            <>
              <div><div className={labelCls}>买入区下限</div><input value={buyLow} onChange={(e) => setBuyLow(e.target.value)} className={inputCls} /></div>
              <div><div className={labelCls}>买入区上限</div><input value={buyHigh} onChange={(e) => setBuyHigh(e.target.value)} className={inputCls} /></div>
              <div><div className={labelCls}>止损价</div><input value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className={inputCls} /></div>
            </>
          )}
          {mode === "logic" && (
            <>
              <div><div className={labelCls}>买入逻辑（必填）</div><textarea value={thesis} onChange={(e) => setThesis(e.target.value)} rows={2} className={inputCls} /></div>
              <div className="grid grid-cols-2 gap-1.5">
                <div><div className={labelCls}>破位线</div><input value={breakLine} onChange={(e) => setBreakLine(e.target.value)} className={inputCls} /></div>
                <div><div className={labelCls}>所属板块</div><input value={board} onChange={(e) => setBoard(e.target.value)} className={inputCls} /></div>
              </div>
              <div><div className={labelCls}>验证催化点（逗号分隔）</div><input value={catalysts} onChange={(e) => setCatalysts(e.target.value)} className={inputCls} /></div>
              <div><div className={labelCls}>失效条件（每行一条）</div><textarea value={invalidation} onChange={(e) => setInvalidation(e.target.value)} rows={2} className={inputCls} /></div>
              <div><div className={labelCls}>复核周期（天）</div><input value={reviewCycle} onChange={(e) => setReviewCycle(e.target.value)} className={inputCls} /></div>
            </>
          )}
          {(mode === "paper" || mode === "real") && (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                <div><div className={labelCls}>成交价（必填）</div><input value={tradePrice} onChange={(e) => setTradePrice(e.target.value)} className={inputCls} /></div>
                <div><div className={labelCls}>数量（必填）</div><input value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} /></div>
              </div>
              <div><div className={labelCls}>买入逻辑</div><textarea value={thesis} onChange={(e) => setThesis(e.target.value)} rows={2} className={inputCls} /></div>
              <div className="grid grid-cols-2 gap-1.5">
                <div><div className={labelCls}>破位线</div><input value={breakLine} onChange={(e) => setBreakLine(e.target.value)} className={inputCls} /></div>
                <div><div className={labelCls}>板块</div><input value={board} onChange={(e) => setBoard(e.target.value)} className={inputCls} /></div>
              </div>
              <div><div className={labelCls}>失效条件（每行一条）</div><textarea value={invalidation} onChange={(e) => setInvalidation(e.target.value)} rows={2} className={inputCls} /></div>
              <div><div className={labelCls}>复核周期（天）</div><input value={reviewCycle} onChange={(e) => setReviewCycle(e.target.value)} className={inputCls} /></div>
              <div><div className={labelCls}>备注</div><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></div>
            </>
          )}
          <button onClick={submit} disabled={busy} className="inline-flex w-full items-center justify-center gap-1 rounded bg-emerald-500/20 px-2 py-1.5 text-[11px] font-bold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"><Save className="h-3 w-3" /> {busy ? "保存中…" : "确认保存"}</button>
          {msg && <div className="rounded bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-300">{msg}</div>}
          {err && <div className="rounded bg-rose-500/10 px-2 py-1 text-[10px] font-bold text-rose-300">{err}</div>}
        </div>
      )}
    </div>
  );
}

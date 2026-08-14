import { useState, useEffect } from "react";
import { loadDisciplineState, saveDisciplineState, computeDisciplineViolations, computeStopLoss, type DisciplineState } from "../lib/discipline";
import { classifyMarketState } from "../lib/marketStateMachine";
import { computePortfolioRisk, type PortfolioRiskResult } from "../lib/portfolioRisk";
import type { OverviewData } from "../lib/marketTypes";
import { usePortfolio } from "../hooks/usePortfolio";
import DisclaimerTag from "./DisclaimerTag";

export default function DisciplinePanel({ overview }: { overview?: OverviewData | null }) {
  const portfolio = usePortfolio();
  const [state, setState] = useState<DisciplineState>(loadDisciplineState);
  const [showForm, setShowForm] = useState(false);
  const [coach, setCoach] = useState<{ biases: Array<{ type: string; severity: string; evidence: string; advice: string }>; sampleSize: number } | null>(null);
  const [tradeForm, setTradeForm] = useState({ code: "", name: "", action: "buy" as "buy" | "sell" | "stop", price: "", quantity: "" });
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formCost, setFormCost] = useState("");
  const [formQty, setFormQty] = useState("");
  const [formCapital, setFormCapital] = useState(String(state.settings.totalCapital));
  const [formMaxSingle, setFormMaxSingle] = useState(String(state.settings.maxSinglePct));

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/coach?days=30", { signal: AbortSignal.timeout(5000) });
        if (r.ok) { const j = await r.json(); if (alive) setCoach(j); }
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, []);

  const displayPositions = portfolio.positions.map((p) => {
    const price = p.lastPrice ?? p.avgCost ?? 0;
    const value = price * Math.max(0, p.netQty);
    return {
      code: p.code,
      name: p.name || p.code,
      cost: p.avgCost ?? null,
      price,
      value,
      pnlPct: p.unrealizedPnlPct ?? (p.avgCost && p.avgCost > 0 && price > 0 ? (price - p.avgCost) / p.avgCost * 100 : null),
    };
  });

  const violations = computeDisciplineViolations({ ...state, positions: displayPositions });
  const totalValue = displayPositions.reduce((s, p) => s + p.value, 0);
  const totalPct = state.settings.totalCapital > 0 ? totalValue / state.settings.totalCapital * 100 : 0;
  const marketState = overview
    ? classifyMarketState({
        sentiment: overview.sentiment ?? 50,
        ztCount: overview.limitPool?.limitUpCount ?? 0,
        dtCount: overview.limitPool?.limitDownCount ?? 0,
        blastedRate: overview.limitPool?.blastedRate ?? 0,
        premiumAvg: overview.premiumAvg ?? null,
        maxBoardHeight: overview.maxBoardHeight ?? null,
      }).state
    : null;
  const risk: PortfolioRiskResult = computePortfolioRisk({
    marketState,
    positionPnlPcts: displayPositions.map((p) => p.pnlPct),
    totalCapital: state.settings.totalCapital,
    currentPositionValue: totalValue,
  });

  const update = (next: DisciplineState) => { setState(next); saveDisciplineState(next); };

  const submitTrade = async () => {
    const price = parseFloat(tradeForm.price);
    const quantity = parseFloat(tradeForm.quantity);
    if (!tradeForm.code || !isFinite(price) || price <= 0 || !isFinite(quantity) || quantity <= 0) return;
    const action = tradeForm.action;
    const pos = portfolio.positions.find((x) => x.code === tradeForm.code.trim());
    const cost = action === "buy" ? price : (pos?.avgCost ?? null);
    await portfolio.addTrade({
      code: tradeForm.code.trim(),
      name: tradeForm.name.trim() || tradeForm.code.trim(),
      action,
      price,
      quantity,
      cost,
      notes: "纪律面板成交录入",
    });
    setTradeForm({ code: "", name: "", action: "buy", price: "", quantity: "" });
    portfolio.refresh();
  };

  const addPosition = async () => {
    const cost = parseFloat(formCost);
    const quantity = parseFloat(formQty);
    if (!formCode || !isFinite(cost) || cost <= 0 || !isFinite(quantity) || quantity <= 0) return;
    await portfolio.addTrade({
      code: formCode.trim(),
      name: formName.trim() || formCode.trim(),
      action: "buy",
      price: cost,
      quantity,
      cost,
      notes: "录入持仓",
    });
    setFormCode(""); setFormName(""); setFormCost(""); setFormQty(""); setShowForm(false);
    portfolio.refresh();
  };

  const applySettings = () => {
    const capital = parseFloat(formCapital);
    const maxSingle = parseFloat(formMaxSingle);
    if (!isFinite(capital) || capital <= 0) return;
    update({ ...state, settings: { ...state.settings, totalCapital: capital, maxSinglePct: isFinite(maxSingle) ? maxSingle : 30 } });
    setShowForm(false);
  };

  return (
    <div className="rounded-xl border border-sky-500/20 bg-sky-950/10 p-3 space-y-2">
      <div className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${risk.overLimit || risk.lossStreak >= 3 ? "border-rose-500/40 bg-rose-500/10 text-rose-300" : marketState === "亢奋普涨" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}>
        <div className="flex items-center justify-between">
          <span className="font-bold">组合风险预算</span>
          <span className="font-mono">{risk.currentPct}% / 上限{risk.maxPositionPct}%<span className="ml-1 text-xs opacity-70">({marketState ?? "-"} ×{risk.marketFactor} ×连亏熔断{risk.lossFactor})</span></span>
        </div>
        <div className="mt-0.5">{risk.advice}</div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-sky-300">持仓与纪律</span>
          <span className="text-[10px] text-slate-500">总资金 {(state.settings.totalCapital / 10000).toFixed(0)}万 · 已用 {totalPct.toFixed(0)}%</span>
          <DisclaimerTag />
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => setShowForm((v) => !v)} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/20">{showForm ? "收起" : "录入持仓"}</button>
          <button onClick={() => update({ ...state, todayNewPositions: 0 })} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/20">重置今日开仓</button>
        </div>
      </div>

      {violations.length > 0 ? (
        <div className="space-y-1">
          {violations.map((v, i) => (
            <div key={i} className={`rounded border px-2 py-1 text-[10px] ${v.level === "critical" ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}>{v.text}</div>
          ))}
        </div>
      ) : displayPositions.length > 0 ? (
        <div className="text-[10px] text-emerald-400">当前持仓符合纪律约束</div>
      ) : null}

      {showForm && (
        <div className="rounded border border-white/10 bg-black/30 p-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <input value={formCode} onChange={(e) => setFormCode(e.target.value)} placeholder="代码（如 600519）" className="rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="名称（可选）" className="rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <input value={formCost} onChange={(e) => setFormCost(e.target.value)} placeholder="成交价" className="rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <input value={formQty} onChange={(e) => setFormQty(e.target.value)} placeholder="数量（手）" className="rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <input value={formCapital} onChange={(e) => setFormCapital(e.target.value)} placeholder="总资金（元）" className="rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <input value={formMaxSingle} onChange={(e) => setFormMaxSingle(e.target.value)} placeholder="单票上限%" className="rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
          </div>
          <div className="flex gap-1.5">
            <button onClick={addPosition} className="rounded bg-sky-500/30 px-2 py-1 text-[10px] font-bold text-sky-200 hover:bg-sky-500/40">写入持仓</button>
            <button onClick={applySettings} className="rounded bg-white/10 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/20">应用资金设置</button>
          </div>
        </div>
      )}

      {displayPositions.length > 0 && (
        <div className="space-y-1">
          {displayPositions.map((p) => {
            const stop = computeStopLoss(p.cost ?? 0, null);
            const pct = state.settings.totalCapital > 0 ? p.value / state.settings.totalCapital * 100 : 0;
            return (
              <div key={p.code} className="flex items-center gap-2 rounded bg-black/20 px-2 py-1 text-[11px]">
                <span className="font-semibold text-slate-200">{p.name}</span>
                <span className="text-slate-500">{p.code}</span>
                <span className="text-slate-400">仓位 {pct.toFixed(1)}%</span>
                {p.pnlPct != null && <span className={`font-mono ${p.pnlPct >= 0 ? "text-rose-400" : "text-emerald-400"}`}>{p.pnlPct >= 0 ? "+" : ""}{p.pnlPct.toFixed(1)}%</span>}
                <span className="text-slate-600" title={stop.note}>止损参考 {stop.stopPrice}</span>
                <button onClick={() => setTradeForm({ code: p.code, name: p.name, action: "sell", price: "", quantity: String(portfolio.positions.find((x) => x.code === p.code)?.netQty ?? "") })} className="ml-auto rounded bg-rose-500/15 px-1 text-[9px] text-rose-300 hover:bg-rose-500/30">卖</button>
              </div>
            );
          })}
        </div>
      )}

      {displayPositions.length === 0 && !showForm && (
        <div className="text-[10px] text-slate-600">录入持仓后自动计算仓位约束与止损参考 · 止损为 ATR/波动率估算，仅供参考</div>
      )}

      <div className="rounded-lg border border-white/10 bg-black/20 p-2">
        <div className="text-[10px] font-bold text-slate-400">成交录入（trade_ledger 唯一 UI 写入口）</div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <input value={tradeForm.code} onChange={(e) => setTradeForm({ ...tradeForm, code: e.target.value })} placeholder="代码" className="w-16 rounded bg-black/40 px-1 py-0.5 text-[10px] text-slate-200" />
          <input value={tradeForm.name} onChange={(e) => setTradeForm({ ...tradeForm, name: e.target.value })} placeholder="名称(可选)" className="w-20 rounded bg-black/40 px-1 py-0.5 text-[10px] text-slate-200" />
          <select value={tradeForm.action} onChange={(e) => setTradeForm({ ...tradeForm, action: e.target.value as "buy" | "sell" | "stop" })} className="rounded bg-black/40 px-1 py-0.5 text-[10px] text-slate-200">
            <option value="buy">买入</option><option value="sell">卖出</option><option value="stop">止损</option>
          </select>
          <input value={tradeForm.price} onChange={(e) => setTradeForm({ ...tradeForm, price: e.target.value })} placeholder="价格" className="w-16 rounded bg-black/40 px-1 py-0.5 text-[10px] text-slate-200" />
          <input value={tradeForm.quantity} onChange={(e) => setTradeForm({ ...tradeForm, quantity: e.target.value })} placeholder="数量(手)" className="w-16 rounded bg-black/40 px-1 py-0.5 text-[10px] text-slate-200" />
          <button onClick={submitTrade} className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/30">记一笔</button>
        </div>
      </div>

      {(coach || portfolio.positions.length > 0) && (
        <div className="rounded-lg border border-white/10 bg-black/20 p-2 space-y-1">
          <div className="text-[10px] font-bold text-slate-400">纪律教练（成交台账 · 行为偏差检测 · N&lt;3 不判定）</div>
          {portfolio.positions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {portfolio.positions.map((p) => (
                <span key={p.code} className="flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">{p.name || p.code} · {p.netQty}手{p.avgCost != null ? ` 均价${p.avgCost}` : ""}</span>
              ))}
            </div>
          )}
          {coach && coach.biases.length > 0 && coach.biases.map((b, i) => (
            <div key={i} className={`rounded px-1.5 py-0.5 text-[10px] ${b.severity === "alert" ? "bg-rose-500/10 text-rose-300" : "bg-amber-500/10 text-amber-200"}`}>{b.type}：{b.advice}（{b.evidence}）</div>
          ))}
          {coach && coach.biases.length === 0 && <div className="text-[10px] text-slate-600">行为偏差检测：样本 {coach.sampleSize} 条，未触发（N&lt;3 不判定）</div>}
        </div>
      )}
    </div>
  );
}

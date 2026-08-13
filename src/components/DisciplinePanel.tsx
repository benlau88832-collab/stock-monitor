// 仓位与纪律面板（v9.19-F7）
// 实时计算：单票超限 / 总仓位超限 / 新开仓次数 / 连续亏损冷静期 / 止损参考
// 报告口径："选股是徒弟活，仓位管理是师傅活"
// v9.36（A1）：组合风险预算联动 —— 总仓位上限 = 基础预算 × 市场状态系数 × 连亏熔断
import { useState, useEffect } from "react";
import { loadDisciplineState, saveDisciplineState, computeDisciplineViolations, computeStopLoss, type DisciplineState } from "../lib/discipline";
import { classifyMarketState } from "../lib/marketStateMachine";
import { computePortfolioRisk, type PortfolioRiskResult } from "../lib/portfolioRisk";
import type { OverviewData } from "../App";
import DisclaimerTag from "./DisclaimerTag";

export default function DisciplinePanel({ overview }: { overview?: OverviewData | null }) {
  const [state, setState] = useState<DisciplineState>(loadDisciplineState);
  const [showForm, setShowForm] = useState(false);
  // v9.130.0（终审 N5）：接线蓝图端点——纪律教练（行为偏差检测）+ 持仓体检（trade_ledger 净额）
  const [coach, setCoach] = useState<{ biases: Array<{ type: string; severity: string; evidence: string; advice: string }>; sampleSize: number } | null>(null);
  const [positions, setPositions] = useState<Array<{ code: string; name: string; netQty: number; avgCost: number | null }>>([]);
  // v9.134.0（游资改造·阶段二）：成交录入（trade_ledger 唯一 UI 写入口——此前生产零调用，纪律教练恒空）
  const [tradeForm, setTradeForm] = useState({ code: "", name: "", action: "buy" as "buy" | "sell" | "stop", price: "", quantity: "" });
  const submitTrade = async () => {
    const price = parseFloat(tradeForm.price);
    const quantity = parseFloat(tradeForm.quantity);
    if (!tradeForm.code || !isFinite(price) || price <= 0) return;
    const { saveTrade, computePnl } = await import("../lib/tradeLedger");
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    // v9.136.0（任务5 闭环）：sell/stop 对称录入 —— 自动匹配持仓成本（/api/positions 体检持仓优先，
    //   其次本地纪律持仓），pnlPct=computePnl 真实盈亏；成本缺失 → null（诚实标注，不编造 0%）
    let cost: number | null = null;
    if (tradeForm.action === "buy") {
      cost = price;
    } else {
      const hp = positions.find(x => x.code === tradeForm.code.trim());
      const lp = state.positions.find(x => x.code === tradeForm.code.trim());
      const c = hp?.avgCost ?? lp?.cost ?? null;
      cost = typeof c === "number" && c > 0 ? c : null;
    }
    await saveTrade({
      date: today, ts: Date.now(), decisionPostRef: null,
      code: tradeForm.code.trim(), name: tradeForm.name.trim() || tradeForm.code.trim(),
      action: tradeForm.action, price, quantity: isFinite(quantity) && quantity > 0 ? quantity : 100,
      cost,
      pnlPct: tradeForm.action === "sell" || tradeForm.action === "stop"
        ? (cost != null ? computePnl(price, cost) : null)
        : null,
      notes: "纪律面板手工录入",
    });
    setTradeForm({ code: "", name: "", action: "buy", price: "", quantity: "" });
    // 录入后刷新纪律教练/持仓体检
    (async () => {
      try {
        const r = await fetch("/api/coach?days=30", { signal: AbortSignal.timeout(5000) });
        if (r.ok) setCoach(await r.json());
        const r2 = await fetch("/api/positions", { signal: AbortSignal.timeout(5000) });
        if (r2.ok) { const j = await r2.json(); setPositions((Array.isArray(j.positions) ? j.positions : []).filter((p: any) => p.open)); }
      } catch { /* 静默 */ }
    })();
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/coach?days=30", { signal: AbortSignal.timeout(5000) });
        if (r.ok) { const j = await r.json(); if (alive) setCoach(j); }
      } catch { /* 静默 */ }
      try {
        const r = await fetch("/api/positions", { signal: AbortSignal.timeout(5000) });
        if (r.ok) { const j = await r.json(); if (alive && Array.isArray(j.positions)) setPositions(j.positions.filter((p: any) => p.open)); }
      } catch { /* 静默 */ }
    })();
    return () => { alive = false; };
  }, []);
  // 录入表单
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formCost, setFormCost] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formCapital, setFormCapital] = useState(String(state.settings.totalCapital));
  const [formMaxSingle, setFormMaxSingle] = useState(String(state.settings.maxSinglePct));

  const violations = computeDisciplineViolations(state);
  const totalValue = state.positions.reduce((s, p) => s + p.value, 0);
  const totalPct = state.settings.totalCapital > 0 ? totalValue / state.settings.totalCapital * 100 : 0;

  // v9.36（A1）：组合风险预算（市场状态 × 连亏熔断）
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
    positionPnlPcts: state.positions.map(p => p.pnlPct),
    totalCapital: state.settings.totalCapital,
    currentPositionValue: totalValue,
  });

  const update = (next: DisciplineState) => { setState(next); saveDisciplineState(next); };

  const addPosition = () => {
    const cost = parseFloat(formCost);
    const value = parseFloat(formValue);
    if (!formCode || !isFinite(cost) || !isFinite(value) || value <= 0) return;
    const pnlPct = cost > 0 ? Math.round((value - cost) / cost * 10000) / 100 : null;
    const next = {
      ...state,
      positions: [...state.positions, { code: formCode.trim(), name: formName.trim() || formCode.trim(), cost, price: cost, value, pnlPct }],
    };
    update(next);
    setFormCode(""); setFormName(""); setFormCost(""); setFormValue("");
    setShowForm(false);
  };

  const removePosition = (code: string) => {
    update({ ...state, positions: state.positions.filter(p => p.code !== code) });
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
      {/* v9.36（A1）：组合风险预算条 */}
      <div className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${
        risk.overLimit || risk.lossStreak >= 3
          ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
          : marketState === "亢奋普涨"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-amber-500/30 bg-amber-500/10 text-amber-300"
      }`}>
        <div className="flex items-center justify-between">
          <span className="font-bold">💰 组合风险预算</span>
          <span className="font-mono">
            {risk.currentPct}% / 上限{risk.maxPositionPct}%
            <span className="ml-1 text-xs opacity-70">({marketState ?? "—"} ×{risk.marketFactor} ×连亏熔断{risk.lossFactor})</span>
          </span>
        </div>
        <div className="mt-0.5">{risk.advice}</div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-sky-300">🛡️ 仓位与纪律</span>
          <span className="text-[10px] text-slate-500">
            总资金 ¥{(state.settings.totalCapital / 10000).toFixed(0)}万 · 已用 {totalPct.toFixed(0)}%
          </span>
          <DisclaimerTag />
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => setShowForm(v => !v)}
            className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/20">
            {showForm ? "收起" : "录入持仓"}
          </button>
          <button onClick={() => update({ ...state, todayNewPositions: 0 })}
            className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/20">
            重置今日开仓
          </button>
        </div>
      </div>

      {/* 违规项（纪律约束） */}
      {violations.length > 0 ? (
        <div className="space-y-1">
          {violations.map((v, i) => (
            <div key={i} className={`rounded border px-2 py-1 text-[10px] ${
              v.level === "critical"
                ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-300"
            }`}>
              {v.level === "critical" ? "🚨" : "⚠️"} {v.text}
            </div>
          ))}
        </div>
      ) : state.positions.length > 0 ? (
        <div className="text-[10px] text-emerald-400">✅ 当前仓位符合纪律约束</div>
      ) : null}

      {/* 录入表单 */}
      {showForm && (
        <div className="rounded border border-white/10 bg-black/30 p-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <input value={formCode} onChange={e => setFormCode(e.target.value)} placeholder="代码（如 600519）"
              className="rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="名称（可选）"
              className="rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <input value={formCost} onChange={e => setFormCost(e.target.value)} placeholder="成本价"
              className="rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <input value={formValue} onChange={e => setFormValue(e.target.value)} placeholder="持仓市值（元）"
              className="rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <input value={formCapital} onChange={e => setFormCapital(e.target.value)} placeholder="总资金（元）"
              className="rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <input value={formMaxSingle} onChange={e => setFormMaxSingle(e.target.value)} placeholder="单票上限%"
              className="rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
          </div>
          <div className="flex gap-1.5">
            <button onClick={addPosition} className="rounded bg-sky-500/30 px-2 py-1 text-[10px] font-bold text-sky-200 hover:bg-sky-500/40">添加持仓</button>
            <button onClick={applySettings} className="rounded bg-white/10 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/20">应用资金设置</button>
          </div>
        </div>
      )}

      {/* 持仓列表 + 止损参考 */}
      {state.positions.length > 0 && (
        <div className="space-y-1">
          {state.positions.map(p => {
            const stop = computeStopLoss(p.cost, null);
            const pct = state.settings.totalCapital > 0 ? p.value / state.settings.totalCapital * 100 : 0;
            return (
              <div key={p.code} className="flex items-center gap-2 rounded bg-black/20 px-2 py-1 text-[11px]">
                <span className="font-semibold text-slate-200">{p.name}</span>
                <span className="text-slate-500">{p.code}</span>
                <span className="text-slate-400">仓位 {pct.toFixed(1)}%</span>
                {p.pnlPct != null && (
                  <span className={`font-mono ${p.pnlPct >= 0 ? "text-rose-400" : "text-emerald-400"}`}>
                    {p.pnlPct >= 0 ? "+" : ""}{p.pnlPct.toFixed(1)}%
                  </span>
                )}
                <span className="text-slate-600" title={stop.note}>
                  止损参考 ¥{stop.stopPrice}
                </span>
                <button onClick={() => removePosition(p.code)} className="ml-auto text-slate-600 hover:text-rose-400">✕</button>
              </div>
            );
          })}
        </div>
      )}

      {state.positions.length === 0 && !showForm && (
        <div className="text-[10px] text-slate-600">录入持仓后自动计算仓位约束与止损参考 · 止损为 ATR/波动率估算，仅供参考</div>
      )}

      {/* v9.134.0（游资改造·阶段二）：成交录入一行表单——trade_ledger 唯一 UI 写入口（拍板确认也会自动写 buy） */}
      <div className="rounded-lg border border-white/10 bg-black/20 p-2">
        <div className="text-[10px] font-bold text-slate-400">✍️ 成交录入（纪律教练数据源；拍板确认会自动记 buy）</div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <input value={tradeForm.code} onChange={(e) => setTradeForm({ ...tradeForm, code: e.target.value })}
            placeholder="代码" className="w-16 rounded bg-black/40 px-1 py-0.5 text-[10px] text-slate-200" />
          <input value={tradeForm.name} onChange={(e) => setTradeForm({ ...tradeForm, name: e.target.value })}
            placeholder="名称(可选)" className="w-20 rounded bg-black/40 px-1 py-0.5 text-[10px] text-slate-200" />
          <select value={tradeForm.action} onChange={(e) => setTradeForm({ ...tradeForm, action: e.target.value as "buy" | "sell" | "stop" })}
            className="rounded bg-black/40 px-1 py-0.5 text-[10px] text-slate-200">
            <option value="buy">买入</option><option value="sell">卖出</option><option value="stop">止损</option>
          </select>
          <input value={tradeForm.price} onChange={(e) => setTradeForm({ ...tradeForm, price: e.target.value })}
            placeholder="价格" className="w-16 rounded bg-black/40 px-1 py-0.5 text-[10px] text-slate-200" />
          <input value={tradeForm.quantity} onChange={(e) => setTradeForm({ ...tradeForm, quantity: e.target.value })}
            placeholder="数量(手)" className="w-16 rounded bg-black/40 px-1 py-0.5 text-[10px] text-slate-200" />
          <button onClick={submitTrade}
            className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/30">记一笔</button>
        </div>
      </div>

      {/* v9.130.0（终审 N5）：纪律教练 + 持仓体检（蓝图 L6 端点接线，0 token 规则检测） */}
      {(coach || positions.length > 0) && (
        <div className="rounded-lg border border-white/10 bg-black/20 p-2 space-y-1">
          <div className="text-[10px] font-bold text-slate-400">🛡️ 纪律教练（成交台账 · 行为偏差检测 · N&lt;3 不判定）</div>
          {positions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {positions.map((p) => (
                <span key={p.code} className="flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">
                  {p.name || p.code} · {p.netQty > 0 ? `${p.netQty}手` : ""}{p.avgCost != null ? ` 均价${p.avgCost}` : ""}
                  {/* v9.136.0（任务5 闭环）：卖出/止损对称联动 —— 一键带出代码/名称/数量，
                      成本由 submitTrade 自动匹配（体检持仓 avgCost），记入 pnl_pct */}
                  <button
                    onClick={() => setTradeForm({ code: p.code, name: p.name || p.code, action: "sell", price: "", quantity: String(p.netQty || "") })}
                    className="rounded bg-rose-500/15 px-1 text-[9px] text-rose-300 hover:bg-rose-500/30"
                    title="一键卖出联动（成本自动匹配）">卖</button>
                </span>
              ))}
            </div>
          )}
          {coach && coach.biases.length > 0 && coach.biases.map((b, i) => (
            <div key={i} className={`rounded px-1.5 py-0.5 text-[10px] ${b.severity === "alert" ? "bg-rose-500/10 text-rose-300" : "bg-amber-500/10 text-amber-200"}`}>
              ⚠ {b.type}：{b.advice}（{b.evidence}）
            </div>
          ))}
          {coach && coach.biases.length === 0 && (
            <div className="text-[10px] text-slate-600">行为偏差检测：样本 {coach.sampleSize} 条，未触发（N&lt;3 不判定）</div>
          )}
        </div>
      )}
    </div>
  );
}

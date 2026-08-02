// 仓位与纪律面板（v9.19-F7）
// 实时计算：单票超限 / 总仓位超限 / 新开仓次数 / 连续亏损冷静期 / 止损参考
// 报告口径："选股是徒弟活，仓位管理是师傅活"
import { useState } from "react";
import { loadDisciplineState, saveDisciplineState, computeDisciplineViolations, computeStopLoss, type DisciplineState } from "../lib/discipline";
import DisclaimerTag from "./DisclaimerTag";

export default function DisciplinePanel() {
  const [state, setState] = useState<DisciplineState>(loadDisciplineState);
  const [showForm, setShowForm] = useState(false);
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
    </div>
  );
}

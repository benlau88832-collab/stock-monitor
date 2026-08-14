// ============================================================
// v9.142.0 Swing War Room V2: actionable dashboard
// Direction from /api/swing/direction; portfolio from usePortfolio.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Plus, RefreshCw, X } from "lucide-react";
import { apiFetch, isLocalServer } from "../lib/cloudStore";
import { analyzeSwing, type KlineBar } from "../lib/swingStage";
import { swingDecision } from "../lib/swingDecision";
import {
  activeEntries, checkAllLedgerAlerts, type LogicEntry,
} from "../lib/logicLedger";
import { usePortfolio, type PortfolioLogicInput, type PortfolioTradeInput } from "../hooks/usePortfolio";
import DecisionActionPanel from "./DecisionActionPanel";

interface SwingBoardScore {
  code: string;
  name: string;
  trend: number;
  fund: number;
  catalyst: number;
  total: number;
  phase: string;
  ma20Up: boolean;
  pct20d: number | null;
  fund10d: number | null;
  fund20d: number | null;
  catalystsTop: string[];
  signals: string[];
}

const PHASE_COLOR: Record<string, string> = {
  主升: "text-emerald-300 bg-emerald-500/10",
  启动: "text-sky-300 bg-sky-500/10",
  加速: "text-amber-300 bg-amber-500/10",
  底部整理: "text-slate-300 bg-white/5",
  退潮: "text-rose-300 bg-rose-500/10",
  资金信号: "text-amber-300 bg-amber-500/10",
  数据不足: "text-slate-500 bg-white/5",
};

function BoardRow({ b }: { b: SwingBoardScore }) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-black text-slate-100">{b.name}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${PHASE_COLOR[b.phase] ?? ""}`}>{b.phase}</span>
        <span className="ml-auto text-sm font-black text-amber-300">{b.total}分</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
        <span>趋势 {b.trend}</span>
        <span>资金 {b.fund}</span>
        <span>催化 {b.catalyst}</span>
        {b.pct20d != null && <span className={b.pct20d >= 0 ? "text-emerald-300/80" : "text-rose-300/80"}>20日 {b.pct20d > 0 ? "+" : ""}{b.pct20d.toFixed(1)}%</span>}
        {b.fund10d != null && <span className="text-slate-400">10日主力 {b.fund10d}亿</span>}
      </div>
      {b.catalystsTop.length > 0 && <div className="mt-1 text-[10px] text-violet-300/80">催化：{b.catalystsTop.join("、")}</div>}
    </div>
  );
}

function TodayActionStrip({ portfolio, directionCount, asOf, degraded, refresh }: {
  portfolio: ReturnType<typeof usePortfolio>;
  directionCount: number;
  asOf: string | null;
  degraded: boolean;
  refresh: () => void;
}) {
  const age = asOf ? Math.max(0, Math.round((Date.now() - new Date(asOf).getTime()) / 1000)) : null;
  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-950/10 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm font-black text-amber-200">今日作战条</span>
        <span className="text-[11px] text-slate-300">方向 <b className="text-amber-300">{directionCount}</b> 个</span>
        <span className="text-[11px] text-slate-300">持仓 <b className={portfolio.positions.length > 0 ? "text-emerald-300" : "text-slate-400"}>{portfolio.positions.length}</b> 只</span>
        <span className="text-[11px] text-slate-300">逻辑 <b className={portfolio.logic.length > 0 ? "text-teal-300" : "text-slate-400"}>{portfolio.logic.length}</b> 条</span>
        <span className="text-[11px] text-slate-300">盯盘 <b className="text-sky-300">{portfolio.watch.length}</b> 只</span>
        <span className="text-[11px] text-slate-300">待办 <b className={portfolio.todos.length > 0 ? "text-rose-300" : "text-slate-400"}>{portfolio.todos.length}</b> 条</span>
        {degraded ? (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">方向榜降级，显示缓存/原因</span>
        ) : age != null && age > 600 ? (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">方向数据 {Math.floor(age / 60)} 分钟前</span>
        ) : (
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">方向数据较新</span>
        )}
        <button onClick={refresh} className="ml-auto inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-1 text-[11px] font-bold text-amber-200 hover:bg-amber-500/30">
          <RefreshCw className="h-3 w-3" /> 刷新
        </button>
      </div>
    </div>
  );
}

function LogicLedgerPanel({ entries, priceMap, boardHealth, onAdd, onUpdate, onRemove }: {
  entries: LogicEntry[];
  priceMap: Map<string, number>;
  boardHealth: Map<string, boolean>;
  onAdd: (input: PortfolioLogicInput) => Promise<void>;
  onUpdate: (input: PortfolioLogicInput) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", thesis: "", catalystDesc: "", catalystKind: "价格" as LogicEntry["catalysts"][0]["kind"], dueDate: "", breakLine: "" });
  const active = activeEntries(entries);
  const alerts = checkAllLedgerAlerts(entries, { price: null, boardHealthy: null }); void alerts;

  const withLive = checkAllLedgerAlerts(entries, {
    price: null,
    boardHealthy: null,
  }).concat(
    active.map((e) => checkAllLedgerAlerts([e], {
      price: priceMap.get(e.code) ?? null,
      boardHealthy: e.board ? (boardHealth.get(e.board) ?? null) : null,
    })).flat(),
  );
  const liveAlerts = withLive.filter((a, i, arr) => arr.findIndex((x) => x.type === a.type && x.code === a.code) === i);

  const submit = async () => {
    if (!form.code.trim() || !form.thesis.trim()) return;
    await onAdd({
      code: form.code.trim(),
      name: form.name.trim() || form.code.trim(),
      thesis: form.thesis.trim(),
      catalysts: form.catalystDesc.trim()
        ? [{ kind: form.catalystKind, desc: form.catalystDesc.trim(), dueDate: form.dueDate || null, status: "待验证" as const }]
        : [],
      breakLine: form.breakLine ? Number(form.breakLine) : null,
      board: null,
      status: "验证中",
    });
    setForm({ code: "", name: "", thesis: "", catalystDesc: "", catalystKind: "价格", dueDate: "", breakLine: "" });
    setAdding(false);
  };

  if (active.length === 0 && !adding) {
    return (
      <div className="rounded-xl border border-teal-500/25 bg-teal-950/10 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-teal-300">持仓逻辑台账（{active.length} 条）</span>
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded bg-teal-500/20 px-2 py-1 text-[11px] font-bold text-teal-200 hover:bg-teal-500/30">
            <Plus className="h-3 w-3" /> 录入逻辑
          </button>
        </div>
        <div className="mt-1 text-[11px] text-slate-500">记录每只持仓为什么买、催化验证点、破位线；系统跟踪兑现/证伪/退潮。</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-teal-500/25 bg-teal-950/10 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-teal-300">持仓逻辑台账（{active.length} 条）</span>
        <button onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-1 rounded bg-teal-500/20 px-2 py-1 text-[11px] font-bold text-teal-200 hover:bg-teal-500/30">
          {adding ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />} {adding ? "收起" : "新增"}
        </button>
      </div>

      {liveAlerts.length > 0 && (
        <div className="space-y-1">
          {liveAlerts.slice(0, 5).map((a, i) => (
            <div key={i} className={`rounded px-2 py-1 text-[11px] font-bold ${a.severity === "critical" ? "bg-rose-500/15 text-rose-300" : a.severity === "warning" ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300"}`}>
              {a.severity === "critical" ? <AlertTriangle className="mr-1 inline h-3 w-3" /> : null}{a.message}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="space-y-1.5 rounded bg-black/20 p-2">
          <div className="flex gap-1.5">
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="代码 600001" className="w-24 rounded bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none border border-white/10" />
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="名称" className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none border border-white/10" />
          </div>
          <input value={form.thesis} onChange={(e) => setForm({ ...form, thesis: e.target.value })} placeholder="买入逻辑：为什么买" className="w-full rounded bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none border border-white/10" />
          <div className="flex gap-1.5">
            <select value={form.catalystKind} onChange={(e) => setForm({ ...form, catalystKind: e.target.value as LogicEntry["catalysts"][0]["kind"] })} className="rounded bg-black/30 px-1.5 py-1 text-xs text-slate-300 outline-none border border-white/10">
              {["价格", "业绩", "政策", "订单", "其他"].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input value={form.catalystDesc} onChange={(e) => setForm({ ...form, catalystDesc: e.target.value })} placeholder="催化验证点" className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none border border-white/10" />
            <input value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} type="date" className="rounded bg-black/30 px-1.5 py-1 text-xs text-slate-200 outline-none border border-white/10" />
          </div>
          <div className="flex gap-1.5">
            <input value={form.breakLine} onChange={(e) => setForm({ ...form, breakLine: e.target.value })} placeholder="破位线（跌破即离场）" className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none border border-white/10" />
            <button onClick={submit} className="rounded bg-teal-500/25 px-3 py-1 text-xs font-bold text-teal-200 hover:bg-teal-500/35">保存</button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {active.map((e) => (
          <div key={e.id} className="rounded border border-white/5 bg-black/20 px-2 py-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-100">{e.name}（{e.code}）</span>
              <span className={`rounded px-1.5 py-px text-[10px] font-bold ${e.status === "验证中" ? "bg-sky-500/15 text-sky-300" : e.status === "已兑现" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>{e.status}</span>
              <span className="ml-auto text-[10px] text-slate-500">{priceMap.get(e.code) != null ? `现价 ${priceMap.get(e.code)}` : "暂无现价"}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-300">{e.thesis}</div>
            {e.catalysts.map((c, i) => (
              <div key={i} className="mt-0.5 text-[10px] text-slate-500">{c.kind}·{c.desc}{c.dueDate ? `（${c.dueDate}）` : ""} <b className={c.status === "已兑现" ? "text-emerald-300" : c.status === "已证伪" ? "text-rose-300" : "text-amber-300"}>{c.status}</b></div>
            ))}
            {e.breakLine != null && <div className="mt-0.5 text-[10px] text-rose-300/70">破位线 {e.breakLine}</div>}
            <div className="mt-1 flex flex-wrap gap-1">
              <button onClick={() => onUpdate({ id: e.id, code: e.code, name: e.name, thesis: e.thesis, status: "已兑现" })} className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/30">兑现</button>
              <button onClick={() => onUpdate({ id: e.id, code: e.code, name: e.name, thesis: e.thesis, status: "已证伪" })} className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/30">证伪</button>
              <button onClick={() => onUpdate({ id: e.id, code: e.code, name: e.name, thesis: e.thesis, status: "已离场" })} className="rounded bg-slate-500/15 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-500/30">离场</button>
              <button onClick={() => onRemove(e.id)} className="ml-auto rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/25">删除</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SwingDecisionCard({ addTrade, saveLogic }: {
  addTrade: (input: PortfolioTradeInput) => Promise<any>;
  saveLogic: (input: PortfolioLogicInput) => Promise<any>;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReturnType<typeof swingDecision> | null>(null);
  const [stage, setStage] = useState<ReturnType<typeof analyzeSwing> | null>(null);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [chainCtx, setChainCtx] = useState<{ chain: any; signals: any } | null>(null);
  const [err, setErr] = useState("");

  const run = async () => {
    const c = code.trim();
    if (!/^\d{6}$/.test(c)) { setErr("请输入 6 位股票代码"); return; }
    setBusy(true); setErr(""); setResult(null); setStage(null);
    try {
      const r = await apiFetch("/api/decisions/swing", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: c }),
      });
      if (!r.ok) {
        const ej = await r.json().catch(() => ({}));
        throw new Error(ej?.error ?? `波段决策服务 ${r.status}`);
      }
      const j = await r.json();
      setStage(j.stage ?? null);
      setLastPrice(j.snap?.price ?? j.stage?.ma20 ?? null);
      setResult(j.decision ?? null);
      setChainCtx(j.chain?.chain ? j.chain : null);
      if (j.llmError) setErr(`AI 研判暂不可用，已使用规则研判：${j.llmError}`);
    } catch (e) {
      try {
        const kr = await apiFetch(`/api/proxy/stock-kline?code=${c}&days=70`);
        if (!kr.ok) throw new Error("K线获取失败");
        const kj = await kr.json();
        const rows: string[] = kj?.klines ?? [];
        const bars: KlineBar[] = rows.map((line) => {
          const [date, open, close, high, low, volume] = line.split(",");
          return { date, open: Number(open), close: Number(close), high: Number(high), low: Number(low), volume: Number(volume) || 0 };
        });
        if (bars.length < 30) { setErr("K线数据不足（<30 根）"); setBusy(false); return; }
        const st = analyzeSwing(bars);
        setStage(st);
        setLastPrice(bars[bars.length - 1].close);
        setResult(swingDecision({ stage: st }));
      } catch (e2) { setErr(String(e2)); }
    }
    setBusy(false);
  };


  return (
    <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/10 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-emerald-300">波段决策卡</span>
        <span className="text-[10px] text-slate-500">平台突破 / 放量首板后低吸</span>
      </div>
      <div className="mt-2 flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位代码" className="w-28 rounded bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none border border-white/10" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称(可选)" className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none border border-white/10" />
        <button onClick={run} disabled={busy} className="inline-flex items-center gap-1 rounded bg-emerald-500/25 px-3 py-1 text-xs font-bold text-emerald-200 hover:bg-emerald-500/35 disabled:opacity-50">
          <Activity className="h-3 w-3" /> {busy ? "分析中" : "分析"}
        </button>
      </div>
      {err && <div className="mt-1 text-[11px] text-rose-300">{err}</div>}
      {result && (
        <div className="mt-2 space-y-1.5 text-[11px]">
          <div className="flex items-center gap-2">
            <span className={`text-lg font-black ${result.verdict === "波段买入" ? "text-emerald-300" : result.verdict === "持有" ? "text-teal-300" : result.verdict === "减仓" ? "text-amber-300" : result.verdict === "观望" ? "text-slate-300" : "text-rose-300"}`}>{result.signal}</span>
            {stage && <span className="text-slate-300">位置：<b className="text-sky-300">{stage.phase}</b></span>}
          {chainCtx?.chain && <div className="text-[10px] text-teal-300/80">产业链：{chainCtx.chain.chainName} · {chainCtx.chain.nodeName} · 上游 {chainCtx.chain.upstream.join(" / ") || "无"} → 下游 {chainCtx.chain.downstream.join(" / ") || "无"}</div>}
            {lastPrice != null && <span className="text-slate-400">参考价 {lastPrice.toFixed(2)}</span>}
          </div>
          {result.buyPoint && <div className="text-cyan-300">买点：{result.buyPoint}</div>}
          {result.verdict === "波段买入" && <div className="text-slate-300">止损 {result.stopLossPct}% 路 止盈 +{result.targetPct}% 路 仓位 {result.positionRange[0]}-{result.positionRange[1]}%</div>}
          {result.reasons.length > 0 && <div className="text-emerald-300/80">{result.reasons.join("；")}</div>}
          {result.blocks.length > 0 && <div className="text-rose-300/80">{result.blocks.join("；")}</div>}
            <DecisionActionPanel code={code.trim()} name={name.trim() || code.trim()} price={lastPrice} defaultThesis={`${result?.reasons.join("；") || stage?.signals.join("；") || "波段决策"}；止损参考 ${result?.stopLossPct != null ? Math.round((lastPrice ?? 0) * (1 - result.stopLossPct / 100) * 100) / 100 : ""}`} addTrade={addTrade} saveLogic={saveLogic} />
        </div>
      )}
    </div>
  );
}

export default function SwingWarRoomV2() {
  const portfolio = usePortfolio();
  const [boards, setBoards] = useState<SwingBoardScore[]>([]);
  const [boardRaw, setBoardRaw] = useState<Array<{ score: SwingBoardScore; klines: KlineBar[]; fundSeq: number[] }>>([]);
  const [loading, setLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);

  const refreshDirection = useCallback(async () => {
    if (!isLocalServer()) return;
    setLoading(true);
    try {
      const r = await apiFetch("/api/swing/direction", { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`direction ${r.status}`);
      const j = await r.json();
      setBoards(Array.isArray(j.boards) ? j.boards : []);
      setBoardRaw(Array.isArray(j.raw) ? j.raw : []);
      setDegraded(Boolean(j.degraded));
      setReason(j.reason ?? null);
      setAsOf(j.asOf ?? null);
    } catch (e) {
      setDegraded(true);
      setReason(String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refreshDirection(); }, [refreshDirection]);
  useEffect(() => { portfolio.refresh(); }, [portfolio.refresh]);

  const priceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of portfolio.watch) if (w.price != null && Number(w.price) > 0) m.set(String(w.code), Number(w.price));
    for (const p of portfolio.positions) if (p.lastPrice != null && Number(p.lastPrice) > 0) m.set(String(p.code), Number(p.lastPrice));
    return m;
  }, [portfolio.watch, portfolio.positions]);

  const boardHealth = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const b of boards) m.set(String(b.name), b.phase !== "退潮");
    return m;
  }, [boards]);

  const addLogic = async (input: PortfolioLogicInput) => { await portfolio.saveLogic(input); portfolio.refresh(); };
  const updateLogic = async (input: PortfolioLogicInput) => { await portfolio.saveLogic(input); portfolio.refresh(); };
  const removeLogic = async (id: string) => { await portfolio.deleteLogic(id); portfolio.refresh(); };

  return (
    <div className="space-y-3">
      <TodayActionStrip portfolio={portfolio} directionCount={boards.length} asOf={asOf} degraded={degraded} refresh={() => { refreshDirection(); portfolio.refresh(); }} />

      {degraded && reason && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          <AlertTriangle className="mr-1 inline h-3 w-3" /> 方向榜降级：{reason}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-xl border border-sky-500/20 bg-sky-950/10 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-black text-sky-300">波段方向榜</span>
            <button onClick={refreshDirection} disabled={loading} className="inline-flex items-center gap-1 rounded bg-sky-500/20 px-2 py-1 text-[11px] text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
              <RefreshCw className="h-3 w-3" /> {loading ? "计算中" : "刷新"}
            </button>
          </div>
          <div className="mt-2 space-y-1.5">
            {boards.length === 0 ? (
              <div className="text-xs text-slate-600">{degraded ? "方向数据暂不可用，已显示降级原因；有涨停池/资金数据后会自动计算。" : "正在计算方向榜..."}</div>
            ) : boards.slice(0, 6).map((b) => <BoardRow key={b.code} b={b} />)}
          </div>
        </div>

        <SwingDecisionCard addTrade={portfolio.addTrade} saveLogic={portfolio.saveLogic} />
      </div>

      <LogicLedgerPanel
        entries={portfolio.logic}
        priceMap={priceMap}
        boardHealth={boardHealth}
        onAdd={addLogic}
        onUpdate={updateLogic}
        onRemove={removeLogic}
      />

      {portfolio.todos.length > 0 && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-950/10 p-3">
          <span className="text-xs font-bold text-rose-300">今日待办（{portfolio.todos.length}）</span>
          <div className="mt-1.5 space-y-1">
            {portfolio.todos.slice(0, 8).map((t, i) => (
              <div key={i} className={`rounded px-2 py-1 text-[11px] ${t.severity === "critical" ? "bg-rose-500/10 text-rose-300" : t.severity === "warning" ? "bg-amber-500/10 text-amber-300" : "bg-sky-500/10 text-sky-300"}`}>
                {t.message}
              </div>
            ))}
          </div>
        </div>
      )}

      <details className="rounded-xl border border-teal-500/20 bg-teal-950/10">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold text-teal-300">景气度研究（收起）</summary>
        <div className="space-y-1.5 px-3 pb-3">
          {boardRaw.length === 0 ? (
            <div className="text-[11px] text-slate-500">暂无景气度原始数据；方向榜恢复后自动填充。</div>
          ) : boardRaw.slice(0, 5).map((raw) => (
            <div key={raw.score.code} className="rounded-lg border border-teal-500/15 bg-black/20 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-slate-100">{raw.score.name}</span>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-amber-300 bg-amber-500/10">{raw.score.phase}</span>
                <span className="ml-auto text-xs font-black text-teal-300">{raw.score.total}分</span>
              </div>
              <div className="mt-1 text-[10px] text-slate-400">资金 {raw.score.fund} · 催化 {raw.score.catalyst} · 10日主力 {raw.score.fund10d ?? "-"}亿 · 20日 {raw.score.fund20d ?? "-"}亿</div>
              {raw.score.signals.slice(0, 4).map((sig, i) => <div key={i} className="text-[10px] text-slate-500">· {sig}</div>)}
            </div>
          ))}
          <div className="text-[10px] text-slate-600">板块K线缺失时仅展示资金/涨停维度，K线恢复后自动升级为完整景气评分。</div>
        </div>
      </details>
    </div>
  );
}

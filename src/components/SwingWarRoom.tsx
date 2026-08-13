// ============================================================
// v9.138.0（波段重构·阶段一）：🎯 波段作战室 —— 波段游资（3天-1个月）主屏
// 定位：打开页面 30 秒内回答波段客的 4 件事：
//   ① 哪个方向在走波段趋势（波段主线榜：趋势+资金+催化三维）
//   ② 我的持仓逻辑还在不在（持仓逻辑台账 + 四类提醒）
//   ③ 有没有到买点/卖点（波段决策卡：位置/买点/止损/止盈）
//   ④ 财报/业绩验证窗口（业绩日历）
// 数据：行业板块指数日K（东财 push2his 90.BKxxxx，腾讯兜底）+ fund_streak 历史（PG/kv）
//      + 快讯催化 + logicLedger（localStorage）+ 业绩日历（纯函数）
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { analyzeSwing, type KlineBar } from "../lib/swingStage";
import { scoreBoard, rankSwingBoards, type SwingBoardScore } from "../lib/swingMainline";
import { swingDecision } from "../lib/swingDecision";
import {
  loadLedger, saveEntry, removeEntry, checkAllLedgerAlerts, activeEntries,
  type LogicEntry,
} from "../lib/logicLedger";
import { earningsWindows, checkAllEarnings } from "../lib/earningsCalendar";
import { apiFetch } from "../lib/cloudStore";
import { localDateStr } from "../lib/format";

// ---------- 数据装配：板块指数日K（东财 push2his 90.BKxxxx） ----------
async function fetchBoardKlines(boardCode: string, days = 60): Promise<KlineBar[] | null> {
  try {
    const secid = `90.${boardCode}`;
    const r = await apiFetch(`/api/proxy/board-kline?secid=${encodeURIComponent(secid)}&days=${days}`);
    if (!r.ok) return null;
    const j = await r.json();
    const rows: string[] = j?.klines ?? [];
    if (!Array.isArray(rows) || rows.length < 25) return null;
    return rows.map(line => {
      // push2his kline 列序：date,open,close,high,low,volume,amount,amplitude,pct,chg,turnover —— volume 在第 6 列(索引5)
      const [date, open, close, high, low, volume] = line.split(",");
      return { date, open: Number(open), close: Number(close), high: Number(high), low: Number(low), volume: Number(volume) || 0 };
    });
  } catch { return null; }
}

// ---------- 资金序列：fund_streak 历史（PG kv，近 20 交易日） ----------
async function fetchFundSeq(boardName: string, days = 20): Promise<number[]> {
  const seq: number[] = [];
  try {
    const d = new Date();
    for (let i = 0; i < days; i++) {
      const dd = new Date(d); dd.setDate(dd.getDate() - i);
      const ds = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}-${String(dd.getDate()).padStart(2, "0")}`;
      const r = await apiFetch(`/api/db/kv?key=${encodeURIComponent(`fund_streak:${ds}`)}`);
      if (r.ok) {
        const j = await r.json();
        const items = j?.value?.items ?? [];
        const hit = items.find((x: { name?: string; board?: string }) => (x.name ?? x.board) === boardName);
        if (hit && Number.isFinite(Number(hit.mainNet))) seq.push(Number(hit.mainNet));
      }
    }
  } catch { /* 部分缺失容忍 */ }
  return seq.reverse();
}

// ---------- 板块列表来源：涨停池 hybk 行业（今日强势行业）+ 资金榜 ----------
interface BoardSource { code: string; name: string }

// ============================================================
// 组件：波段方向榜（单行）
// ============================================================
function SwingBoardRow({ b }: { b: SwingBoardScore }) {
  const phaseColor: Record<string, string> = {
    主升: "text-emerald-300 bg-emerald-500/10", 启动: "text-sky-300 bg-sky-500/10",
    加速: "text-amber-300 bg-amber-500/10", 底部整理: "text-slate-300 bg-white/5",
    退潮: "text-rose-300 bg-rose-500/10", 数据不足: "text-slate-500 bg-white/5",
  };
  return (
    <div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-black text-slate-100">{b.name}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${phaseColor[b.phase] ?? ""}`}>{b.phase}</span>
        <span className="ml-auto text-sm font-black text-amber-300">{b.total}分</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
        <span>趋势 {b.trend}</span>
        <span>资金 {b.fund}</span>
        <span>催化 {b.catalyst}</span>
        {b.pct20d != null && <span className={b.pct20d >= 0 ? "text-emerald-300/80" : "text-rose-300/80"}>20日 {b.pct20d > 0 ? "+" : ""}{b.pct20d.toFixed(1)}%</span>}
        {b.fund10d != null && <span className={b.fund10d >= 0 ? "text-emerald-300/80" : "text-rose-300/80"}>10日主力 {b.fund10d > 0 ? "+" : ""}{b.fund10d}亿</span>}
        {b.fund20d != null && <span>20日 {b.fund20d > 0 ? "+" : ""}{b.fund20d}亿</span>}
      </div>
      {b.catalystsTop.length > 0 && (
        <div className="mt-1 text-[10px] text-violet-300/80">催化：{b.catalystsTop.join("、")}</div>
      )}
    </div>
  );
}

// ============================================================
// 组件：波段方向榜（主列表）
// ============================================================
function SwingBoardList({ boards, loading }: { boards: SwingBoardScore[]; loading: boolean }) {
  if (loading) return <div className="text-xs text-slate-500">波段主线分析中…（板块指数K线 + 资金历史）</div>;
  if (boards.length === 0) return <div className="text-xs text-slate-600">暂无波段方向数据（板块K线/资金历史未就绪；持仓逻辑台账不受影响）</div>;
  const top = boards.slice(0, 8);
  return (
    <div className="space-y-1.5">
      {top.map(b => <SwingBoardRow key={b.code} b={b} />)}
      <div className="text-[10px] text-slate-600">评分 = 趋势40% + 资金35% + 催化25%（涨停热度仅作参考）；来源：行业指数K线/资金历史/快讯</div>
    </div>
  );
}

// ============================================================
// 组件：持仓逻辑台账（核心）
// ============================================================
function LogicLedgerPanel({ entries, onAdd, onRemove }: {
  entries: LogicEntry[];
  onAdd: (e: LogicEntry) => void;
  onRemove: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", thesis: "", catalystDesc: "", catalystKind: "价格" as LogicEntry["catalysts"][0]["kind"], dueDate: "", breakLine: "" });
  const alerts = checkAllLedgerAlerts(entries, { price: null, boardHealthy: null });
  const active = activeEntries(entries);

  const submit = () => {
    if (!form.code.trim() || !form.thesis.trim()) return;
    const e: LogicEntry = {
      id: `${form.code.trim()}_${Date.now().toString(36)}`,
      code: form.code.trim(), name: form.name.trim() || form.code.trim(),
      thesis: form.thesis.trim(),
      catalysts: form.catalystDesc.trim()
        ? [{ kind: form.catalystKind, desc: form.catalystDesc.trim(), dueDate: form.dueDate || null, status: "待验证" }]
        : [],
      breakLine: form.breakLine ? Number(form.breakLine) : null,
      board: null, boardCode: null,
      status: "验证中", createdAt: Date.now(), updatedAt: Date.now(),
    };
    onAdd(e);
    setForm({ code: "", name: "", thesis: "", catalystDesc: "", catalystKind: "价格", dueDate: "", breakLine: "" });
    setAdding(false);
  };

  if (active.length === 0 && !adding) {
    return (
      <div className="rounded-lg border border-teal-500/20 bg-teal-950/10 p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-teal-300">🧾 持仓逻辑台账（0 条）</span>
          <button onClick={() => setAdding(true)} className="rounded bg-teal-500/20 px-2 py-0.5 text-[11px] text-teal-200 hover:bg-teal-500/30">＋ 录入持仓逻辑</button>
        </div>
        <div className="mt-1 text-[11px] text-slate-500">记录每只持仓"为什么买 + 催化验证点 + 破位线"，系统跟踪逻辑兑现/证伪/退潮</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-teal-500/20 bg-teal-950/10 p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-teal-300">🧾 持仓逻辑台账（{active.length} 条）</span>
        <button onClick={() => setAdding(v => !v)} className="rounded bg-teal-500/20 px-2 py-0.5 text-[11px] text-teal-200 hover:bg-teal-500/30">{adding ? "收起" : "＋ 新增"}</button>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-1">
          {alerts.map((a, i) => (
            <div key={i} className={`rounded px-2 py-1 text-[11px] font-bold ${a.severity === "critical" ? "bg-rose-500/15 text-rose-300" : a.severity === "warning" ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300"}`}>
              {a.severity === "critical" ? "🚨" : a.severity === "warning" ? "⚠️" : "ℹ️"} {a.message}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="space-y-1.5 rounded bg-black/20 p-2">
          <div className="flex gap-1.5">
            <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="代码 600001"
              className="w-24 rounded bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none border border-white/10" />
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="名称"
              className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none border border-white/10" />
          </div>
          <input value={form.thesis} onChange={e => setForm({ ...form, thesis: e.target.value })} placeholder="买入逻辑：为什么买（如：铜价上涨传导业绩）"
            className="w-full rounded bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none border border-white/10" />
          <div className="flex gap-1.5">
            <select value={form.catalystKind} onChange={e => setForm({ ...form, catalystKind: e.target.value as LogicEntry["catalysts"][0]["kind"] })}
              className="rounded bg-black/30 px-1.5 py-1 text-xs text-slate-300 outline-none border border-white/10">
              {["价格", "业绩", "政策", "订单", "其他"].map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <input value={form.catalystDesc} onChange={e => setForm({ ...form, catalystDesc: e.target.value })} placeholder="催化验证点（如：铜价创20日新高）"
              className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none border border-white/10" />
            <input value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} type="date"
              className="rounded bg-black/30 px-1.5 py-1 text-xs text-slate-200 outline-none border border-white/10" />
          </div>
          <div className="flex gap-1.5">
            <input value={form.breakLine} onChange={e => setForm({ ...form, breakLine: e.target.value })} placeholder="破位线（跌破即离场，如 10.5）"
              className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none border border-white/10" />
            <button onClick={submit} className="rounded bg-teal-500/25 px-3 py-1 text-xs font-bold text-teal-200 hover:bg-teal-500/35">保存</button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {active.map(e => (
          <div key={e.id} className="rounded border border-white/5 bg-black/20 px-2 py-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-100">{e.name}（{e.code}）</span>
              <span className={`rounded px-1.5 py-px text-[10px] font-bold ${e.status === "验证中" ? "bg-sky-500/15 text-sky-300" : e.status === "已兑现" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>{e.status}</span>
              <button onClick={() => onRemove(e.id)} className="ml-auto text-[10px] text-slate-600 hover:text-rose-300">✕ 移除</button>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-300">📌 {e.thesis}</div>
            {e.catalysts.length > 0 && (
              <div className="mt-0.5 text-[10px] text-slate-500">
                {e.catalysts.map((c, i) => (
                  <span key={i} className="mr-2">🔎 {c.kind}·{c.desc}{c.dueDate ? `（${c.dueDate}）` : ""}：<b className={c.status === "已兑现" ? "text-emerald-300" : c.status === "已证伪" ? "text-rose-300" : "text-amber-300"}>{c.status}</b></span>
                ))}
              </div>
            )}
            {e.breakLine != null && <div className="mt-0.5 text-[10px] text-rose-300/70">🛑 破位线 {e.breakLine}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 组件：波段决策卡（单标的：输入代码 → 位置+决策）
// ============================================================
function SwingDecisionCard() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReturnType<typeof swingDecision> | null>(null);
  const [stage, setStage] = useState<ReturnType<typeof analyzeSwing> | null>(null);
  const [err, setErr] = useState("");

  const run = async () => {
    const c = code.trim();
    if (!/^\d{6}$/.test(c)) { setErr("请输入 6 位股票代码"); return; }
    setBusy(true); setErr(""); setResult(null); setStage(null);
    try {
      // 日K（服务端 /api/db/stock/:code 已含 kline？用独立 K 线接口）
      const r = await apiFetch(`/api/proxy/stock-kline?code=${c}&days=70`);
      if (!r.ok) throw new Error("K线获取失败");
      const j = await r.json();
      const rows: string[] = j?.klines ?? [];
      const bars: KlineBar[] = rows.map(line => {
        const [date, open, close, high, low, volume] = line.split(",");
        return { date, open: Number(open), close: Number(close), high: Number(high), low: Number(low), volume: Number(volume) || 0 };
      });
      if (bars.length < 30) { setErr("K线数据不足（<30 根）"); setBusy(false); return; }
      const st = analyzeSwing(bars);
      setStage(st);
      const d = swingDecision({ stage: st });
      setResult(d);
    } catch (e) { setErr(String(e)); }
    setBusy(false);
  };

  const vc = result?.verdict === "波段买入" ? "text-emerald-300" : result?.verdict === "持有" ? "text-teal-300" : result?.verdict === "减仓" ? "text-amber-300" : result?.verdict === "观望" ? "text-slate-300" : "text-rose-300";

  return (
    <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/10 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-emerald-300">🎯 波段决策卡（趋势位置 · 买点 · 止损止盈）</span>
        <span className="text-[10px] text-slate-500">3天-1个月口径 · 平台突破/首板低吸</span>
      </div>
      <div className="mt-2 flex gap-2">
        <input value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") run(); }}
          placeholder="输入 6 位代码" className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none border border-white/10 focus:border-emerald-500/40" />
        <button onClick={run} disabled={busy} className="rounded bg-emerald-500/25 px-3 py-1 text-xs font-bold text-emerald-200 hover:bg-emerald-500/35 disabled:opacity-50">
          {busy ? "分析中…" : "⚡ 波段分析"}
        </button>
      </div>
      {err && <div className="mt-1 text-[11px] text-rose-300">{err}</div>}
      {result && (
        <div className="mt-2 space-y-1.5 text-[11px]">
          <div className="flex items-center gap-2">
            <span className={`text-lg font-black ${vc}`}>{result.signal}</span>
          </div>
          {stage && (
            <div className="text-slate-300">
              波段位置：<b className="text-sky-300">{stage.phase}</b>
              {stage.platform && <span className="ml-1 text-slate-500">平台 {stage.platform[0].toFixed(2)}-{stage.platform[1].toFixed(2)}</span>}
              {stage.ma20 != null && <span className="ml-1 text-slate-500">MA20 {stage.ma20.toFixed(2)}（偏离 {stage.biasMa20?.toFixed(1) ?? "?"}%）</span>}
            </div>
          )}
          {result.buyPoint && <div className="text-cyan-300">买点：{result.buyPoint}</div>}
          {(result.verdict === "波段买入") && (
            <div className="text-slate-300">
              止损 {result.stopLossPct}% · 止盈 +{result.targetPct}% · 建议仓位 {result.positionRange[0]}-{result.positionRange[1]}%
            </div>
          )}
          {result.reasons.length > 0 && <div className="text-emerald-300/80">✓ {result.reasons.join("；")}</div>}
          {result.blocks.length > 0 && <div className="text-rose-300/80">✗ {result.blocks.join("；")}</div>}
          {stage && stage.signals.length > 0 && (
            <div className="text-[10px] text-slate-500">信号：{stage.signals.join("；")}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 主组件：波段作战室
// ============================================================
export default function SwingWarRoom() {
  const [boards, setBoards] = useState<SwingBoardScore[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [entries, setEntries] = useState<LogicEntry[]>(() => loadLedger());
  const [boardSources, setBoardSources] = useState<BoardSource[]>([]);

  // 板块来源：今日涨停池行业（hybk 聚合）+ 兜底静态主流行业
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch("/api/db/zt?date=" + encodeURIComponent(localDateStr()));
        const j = await r.json();
        const pool = Array.isArray(j?.pool) ? j.pool : [];
        const byBoard = new Map<string, string>();
        for (const p of pool) {
          const h = String(p?.hybk ?? p?.hybk ?? "");
          if (h && h !== "未分类" && !byBoard.has(h)) byBoard.set(h, String(p?.c ?? ""));
        }
        if (alive && byBoard.size > 0) {
          setBoardSources([...byBoard.entries()].map(([name]) => ({ code: "", name })));
        }
      } catch { /* 涨停池不可用 → 空 */ }
    })();
    return () => { alive = false; };
  }, []);

  // 波段主线榜计算（板块K线 + 资金 + 催化）
  const refreshBoards = useCallback(async () => {
    if (boardSources.length === 0) return;
    setBoardsLoading(true);
    try {
      const results: SwingBoardScore[] = [];
      // 并行取前 8 个板块（限并发防东财限流）
      const sources = boardSources.slice(0, 8);
      for (const src of sources) {
        try {
          // 板块代码：资金榜 kv 里找 BK 代码
          let bkCode = src.code;
          if (!bkCode) {
            const fr = await apiFetch(`/api/db/kv?key=${encodeURIComponent(`fund_streak:${localDateStr()}`)}`);
            if (fr.ok) {
              const fj = await fr.json();
              const items = fj?.value?.items ?? [];
              const hit = items.find((x: { name?: string; board?: string }) => (x.name ?? x.board) === src.name);
              bkCode = hit?.code ?? "";
            }
          }
          if (!bkCode) continue;
          const klines = await fetchBoardKlines(bkCode, 60);
          if (!klines) continue;
          const fundSeq = await fetchFundSeq(src.name, 20);
          const s = scoreBoard({ code: bkCode, name: src.name, klines, fundSeq });
          results.push(s);
        } catch { /* 单板块失败跳过 */ }
      }
      setBoards(rankSwingBoards(results));
    } finally { setBoardsLoading(false); }
  }, [boardSources]);

  useEffect(() => {
    if (boardSources.length > 0) refreshBoards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardSources]);

  const addEntry = async (e: LogicEntry) => { await saveEntry(e); setEntries(loadLedger()); };
  const delEntry = (id: string) => { removeEntry(id); setEntries(loadLedger()); };

  const earnWins = earningsWindows();
  const earnAlerts = checkAllEarnings(entries.filter(e => e.status !== "已离场").map(e => ({ code: e.code, name: e.name })));

  return (
    <div className="space-y-3">
      {/* 第一行：波段方向榜 + 业绩日历 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_300px]">
        <div className="rounded-xl border border-sky-500/20 bg-sky-950/10 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-black text-sky-300">📈 波段方向榜（趋势+资金+催化）</span>
            <button onClick={refreshBoards} disabled={boardsLoading}
              className="rounded bg-sky-500/20 px-2 py-0.5 text-[11px] text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
              {boardsLoading ? "分析中…" : "🔄 刷新"}
            </button>
          </div>
          <div className="mt-2">
            <SwingBoardList boards={boards} loading={boardsLoading} />
          </div>
        </div>
        <div className="rounded-xl border border-violet-500/20 bg-violet-950/10 p-3">
          <span className="text-sm font-black text-violet-300">📅 业绩验证日历</span>
          <div className="mt-2 space-y-1">
            {earnWins.slice(0, 4).map((w, i) => (
              <div key={i} className={`rounded px-2 py-1 text-[11px] ${w.active ? "bg-amber-500/15 text-amber-200" : "bg-black/20 text-slate-400"}`}>
                {w.active && <span className="mr-1">🔥</span>}{w.name} · 截止 {w.deadline}
                {w.active && <span className="ml-1 text-amber-300/80">（披露期{ w.daysToDeadline >= 0 ? `，剩 ${w.daysToDeadline} 天` : "已过" }）</span>}
              </div>
            ))}
            {earnAlerts.filter(a => a.alert).length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {earnAlerts.filter(a => a.alert).slice(0, 4).map((a, i) => (
                  <div key={i} className="rounded bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300">🔔 {a.alert}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 第二行：持仓逻辑台账 + 波段决策卡 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr]">
        <LogicLedgerPanel entries={entries} onAdd={addEntry} onRemove={delEntry} />
        <SwingDecisionCard />
      </div>
    </div>
  );
}

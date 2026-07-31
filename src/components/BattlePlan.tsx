import { useState } from "react";
import { fmtPct, pctColor } from "../lib/format";
import { stockRealUrl } from "../lib/realLinks";
import { getHitRateText } from "../lib/recTracker";
import type { GateResult } from "../lib/regimeGate";
import type { ThemeScoreResult } from "../lib/themeScore";
import type { StockScoreResult } from "../lib/stockScore";
import type { ETFScoreResult } from "../lib/etfScore";

// ============== Props ==============
export interface BattlePlanData {
  gate: GateResult;
  themes: ThemeScoreResult[];
  stocks: StockScoreResult[];
  etfs: ETFScoreResult[];
  /** 候选观察池：第4-8名板块 */
  candidateThemes?: ThemeScoreResult[];
  /** 候选观察池：第6-10名个股 */
  candidateStocks?: StockScoreResult[];
}

function scoreColor(s: number): string {
  if (s >= 80) return "text-rose-400";
  if (s >= 60) return "text-amber-300";
  return "text-slate-400";
}

function TierBadge({ tier }: { tier: "A" | "B" | "C" }) {
  const cls = tier === "A" ? "bg-emerald-500/20 text-emerald-300" : tier === "B" ? "bg-amber-500/20 text-amber-300" : "bg-slate-500/20 text-slate-400";
  const label = tier === "A" ? "A档" : tier === "B" ? "B档" : "C档·弱信号";
  return <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${cls}`}>{label}</span>;
}

function scoreBg(s: number): string {
  if (s >= 80) return "border-rose-500/30 bg-rose-500/5";
  if (s >= 60) return "border-amber-500/30 bg-amber-500/5";
  return "border-slate-500/30 bg-slate-500/5";
}

// ============== 因子分解展开 ==============
function FactorRow({ label, score, weight }: { label: string; score: number; weight: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-slate-500">{label}({weight})</span>
      <span className={scoreColor(score)}>{score}</span>
    </div>
  );
}

// ============== 板块卡 ==============
function ThemeCard({ t }: { t: ThemeScoreResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-lg border p-2 ${scoreBg(t.total)}`}>
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setOpen(v => !v)}>
        <div className="flex items-center gap-1">
          <span className="text-xs font-bold text-slate-200">{t.board}</span>
          <span className={`rounded px-1 py-0.5 text-[9px] ${t.kind === "industry" ? "bg-slate-500/20 text-slate-400" : "bg-amber-500/20 text-amber-300"}`}>
            {t.kind === "industry" ? "行业" : "题材"}
          </span>
          <TierBadge tier={t.tier} />
          {t.newsSource && (
            <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${t.newsSource === "LLM" ? "bg-violet-500/20 text-violet-300" : "bg-slate-500/20 text-slate-500"}`}>
              {t.newsSource}
            </span>
          )}
        </div>
        <span className={`text-lg font-black ${scoreColor(t.total)}`}>{t.total}</span>
      </div>
      <div className="text-[11px] text-slate-400 mt-1">阶段: {t.role}</div>
      <div className="text-[11px] text-rose-400/80 mt-0.5">❌ 板块主力净额转负→失效</div>
      {open && (
        <div className="mt-1 border-t border-white/10 pt-1 space-y-0.5">
          <FactorRow label="资金" score={t.factors.fund} weight="35%" />
          <FactorRow label="梯队" score={t.factors.ladder} weight="25%" />
          <FactorRow label="阶段" score={t.factors.stage} weight="20%" />
          <FactorRow label="消息" score={t.factors.news} weight="20%" />
        </div>
      )}
    </div>
  );
}

// ============== 个股卡 ==============
function StockCard({ s }: { s: StockScoreResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-lg border p-2 ${scoreBg(s.total)}`}>
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setOpen(v => !v)}>
        <div>
          <a href={stockRealUrl(s.code)} target="_blank" rel="noopener noreferrer"
            className="text-xs font-bold text-slate-200 hover:text-amber-300">{s.name}</a>
          <span className="text-[11px] text-slate-500 ml-1">{s.code}</span>
          <TierBadge tier={s.tier} />
        </div>
        <span className={`text-lg font-black ${scoreColor(s.total)}`}>{s.total}</span>
      </div>
      <div className="flex items-center gap-2 text-[11px] mt-0.5">
        <span className={pctColor(s.pct)}>{fmtPct(s.pct)}</span>
        <span className="text-slate-400">¥{s.price.toFixed(2)}</span>
      </div>
      <div className="text-[11px] text-rose-400/80 mt-0.5">
        ❌ 断板→失效 | 跌出板块资金Top10→失效
        {s.invalidation && <span className="ml-1">| {s.invalidation}→失效</span>}
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${s.newsSource === "LLM" ? "bg-violet-500/20 text-violet-300" : "bg-slate-500/20 text-slate-500"}`}>
          消息:{s.newsSource}
        </span>
      </div>
      {open && (
        <div className="mt-1 border-t border-white/10 pt-1 space-y-0.5">
          <FactorRow label="资金" score={s.factors.fund} weight="30%" />
          <FactorRow label="流动性" score={s.factors.liquidity} weight="25%" />
          <FactorRow label="梯队" score={s.factors.ladder} weight="20%" />
          <FactorRow label="消息" score={s.factors.news} weight="15%" />
          <FactorRow label="席位" score={s.factors.seat} weight="10%" />
        </div>
      )}
    </div>
  );
}

// ============== ETF 卡 ==============
function ETFCard({ e }: { e: ETFScoreResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-lg border p-2 ${scoreBg(e.total)}`}>
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setOpen(v => !v)}>
        <div className="flex items-center gap-1">
          <span className="text-xs font-bold text-slate-200">{e.name}</span>
          <TierBadge tier={e.tier} />
        </div>
        <span className={`text-lg font-black ${scoreColor(e.total)}`}>{e.total}</span>
      </div>
      {open && (
        <div className="mt-1 border-t border-white/10 pt-1 space-y-0.5">
          <FactorRow label="资金趋势" score={e.factors.fundTrend} weight="40%" />
          <FactorRow label="板块联动" score={e.factors.boardLink} weight="35%" />
          <FactorRow label="宏观" score={e.factors.macro} weight="25%" />
        </div>
      )}
    </div>
  );
}

// ============== 候选观察池 ==============
function CandidatePool({ themes, stocks }: { themes: ThemeScoreResult[]; stocks: StockScoreResult[] }) {
  const [open, setOpen] = useState(false);
  if (themes.length === 0 && stocks.length === 0) return null;
  return (
    <div>
      <button onClick={() => setOpen(v => !v)} className="text-[11px] text-slate-500 hover:text-slate-400">
        {open ? "▲ 收起候选池" : "▼ 候选观察池"}
      </button>
      {open && (
        <div className="mt-1 grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <div className="text-slate-500 mb-0.5">板块候选(第4-8名)</div>
            {themes.map(t => (
              <div key={t.board} className="flex justify-between py-0.5">
                <span className="text-slate-400">{t.board}</span>
                <span className={scoreColor(t.total)}>{t.total} <TierBadge tier={t.tier} /></span>
              </div>
            ))}
          </div>
          <div>
            <div className="text-slate-500 mb-0.5">个股候选(第6-10名)</div>
            {stocks.map(s => (
              <div key={s.code} className="flex justify-between py-0.5">
                <span className="text-slate-400">{s.name}</span>
                <span className={scoreColor(s.total)}>{s.total} <TierBadge tier={s.tier} /></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============== 主组件 ==============
export default function BattlePlan({ data }: { data: BattlePlanData | null }) {
  if (!data) return null;

  const { gate, themes, stocks, etfs } = data;
  // "今日无推荐"仅在三种情况出现：闸门≤0.3 / 硬熔断且全C档 / 数据管道失败
  const allCTier = [...themes, ...stocks].every(x => x.tier === "C") && etfs.every(x => x.tier === "C");
  const showNoRec = (gate.factor <= 0.3) || (gate.reason.length > 0 && allCTier && themes.length + stocks.length + etfs.length > 0) || (themes.length === 0 && stocks.length === 0 && etfs.length === 0);

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4 space-y-3">
      {/* 闸门状态条 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-amber-200">⚔️ 今日作战卡</span>
          <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${
            gate.factor >= 0.8 ? "bg-emerald-500/20 text-emerald-300" :
            gate.factor >= 0.5 ? "bg-amber-500/20 text-amber-300" :
            "bg-rose-500/20 text-rose-300"
          }`}>
            闸门×{gate.factor.toFixed(1)} {gate.label}
          </span>
        </div>
        {gate.reason.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {gate.reason.map((r, i) => (
              <span key={i} className="rounded px-1 py-0.5 text-[10px] bg-rose-500/20 text-rose-300">🔥 {r}</span>
            ))}
          </div>
        )}
      </div>

      {!showNoRec ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* 板块列 */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold text-slate-400">板块推荐</div>
            {themes.length > 0 ? themes.map(t => <ThemeCard key={t.board} t={t} />) : (
              <div className="text-[11px] text-slate-500">无符合条件板块</div>
            )}
          </div>

          {/* 个股列 */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold text-slate-400">个股推荐</div>
            {stocks.length > 0 ? stocks.map(s => <StockCard key={s.code} s={s} />) : (
              <div className="text-[11px] text-slate-500">
                {gate.factor <= 0.3 ? "低闸门期仅推荐ETF" : "无符合条件个股"}
              </div>
            )}
          </div>

          {/* ETF 列 */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold text-slate-400">ETF推荐</div>
            {etfs.length > 0 ? etfs.map(e => <ETFCard key={e.code} e={e} />) : (
              <div className="text-[11px] text-slate-500">无符合条件ETF</div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center py-4 text-sm text-slate-400">
          今日无推荐，空仓也是答案
        </div>
      )}

      {/* 候选观察池（Fix5） */}
      {(data.candidateThemes?.length || data.candidateStocks?.length) ? (
        <CandidatePool themes={data.candidateThemes ?? []} stocks={data.candidateStocks ?? []} />
      ) : null}

      {/* 归因命中率 */}
      <div className="border-t border-white/10 pt-1.5 text-[11px] text-slate-500 text-center">
        📊 {getHitRateText()}
      </div>
    </div>
  );
}

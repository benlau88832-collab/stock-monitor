// ============================================================
// v9.52（V7-3）：今日上车标的清单（"可上车"→"买这只"的可见终点）
// 位置：驾驶舱决策区下方、BattlePlan 之后
// 数据流：可上车主线 MainlineGroup + 涨停池原始 rawZTPool → pickStocks 引擎 → 清单
// 每只：角色徽章(首选/接力/低吸) + 代码名 + 轻量评分 + 建议仓位 + 止损 + 买入逻辑 + 风险
// v9.53（V7-2/10）：每只附 AI 一句话研判（decideForStock）
// ============================================================
import { useMemo, useEffect, useState } from "react";
import type { MainlineGroup } from "../lib/stockToMainline";
import type { ZTPoolItem, ThemeStock } from "../lib/themeLadder";
import { pickStocks, type PickList } from "../lib/stockPicker";
import { decideForStock, type StockVerdict } from "../lib/aiAgent";
import { conceptGroupOf } from "../lib/conceptGroups";
import DisclaimerTag from "./DisclaimerTag";

const roleColor: Record<string, string> = {
  "首选": "bg-rose-500/25 text-rose-300 border-rose-500/50",
  "接力": "bg-amber-500/25 text-amber-300 border-amber-500/50",
  "低吸": "bg-cyan-500/25 text-cyan-300 border-cyan-500/50",
};

/** 涨停池原始项 → ThemeStock（与 themeLadder 同映射） */
function toThemeStock(s: ZTPoolItem): ThemeStock {
  return {
    code: String(s.c), name: String(s.n),
    price: (s.p ?? 0) / 1000, pct: s.zdp ?? 0,
    boardCount: s.lbc ?? 1,
    firstBoardTime: fmtFbt(s.fbt ?? 0),
    sealFund: s.fund ?? 0,
    turnoverRate: s.hs ?? 0,
    amount: s.amount ?? 0,
    blastCount: s.zbc ?? 0,
  };
}
function fmtFbt(t: number): string {
  const s = String(t).padStart(6, "0");
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
}

/** 资金增强（mainline.potential 命中时，V7-13） */
export interface PickFundBoost {
  code: string;
  name: string;
  mainNetPct: number;
  mainNet5dPct: number;
  vetoed: boolean;
  vetoReasons: string[];
}

interface Props {
  candidate: MainlineGroup | null;
  /** 全部涨停池原始数据（组件内按主线名过滤归属个股） */
  rawPool: ZTPoolItem[];
  /** 板块成分股候选池资金增强（mainline.potential → fundBoost） */
  potential?: PickFundBoost[];
  gate?: { mode?: string; factor?: number | null } | null;
}

export default function StockPickList({ candidate, rawPool, potential, gate }: Props) {
  const pick: PickList | null = useMemo(() => {
    if (!candidate || !rawPool || rawPool.length === 0) return null;
    // 归属该主线的涨停股：hybk 精确/包含 + conceptGroups 折叠大类 + 名称包含（V7-1 复盘补强：
    // 主线名常为概念大类如"AI应用"，hybk 是细分行业名，直接子串匹配会漏 → 折叠后匹配）
    const pool: ThemeStock[] = rawPool
      .filter(s => {
        const hybk = String(s.hybk ?? "");
        const name = String(s.n ?? "");
        const g = candidate.mainline;
        const bg = conceptGroupOf(hybk); // hybk → 用户大类（V7-4 修好的归类）
        return hybk === g || hybk.includes(g) || g.includes(hybk)
          || (bg !== null && (bg === g || bg.includes(g) || g.includes(bg)))
          || name.includes(g) || g.includes(name);
      })
      .map(toThemeStock);
    if (pool.length === 0) return null;
    const fundBoost = new Map<string, { mainNetPct: number; mainNet5dPct: number }>();
    for (const p of potential ?? []) {
      if (!p.vetoed) fundBoost.set(p.code, { mainNetPct: p.mainNetPct, mainNet5dPct: p.mainNet5dPct });
    }
    return pickStocks(candidate, pool, {
      gateMode: gate?.mode ?? "full",
      strengthScore: candidate.strengthScore ?? null,
      fundBoost,
    });
  }, [candidate, rawPool, potential, gate]);

  // v9.53（V7-2/10）：AI 逐标的研判 —— 对首选/接力标的（≤3只）做轻量 LLM 研判
  // v9.55-fix（复盘补做）：此前 pct/sealFund/amount/blastCount 全传 0 —— AI 看不到封单/成交/炸板，
  //   研判形同虚设；现从 rawPool 取真实原始字段喂给 decideForStock
  const [aiMap, setAiMap] = useState<Map<string, StockVerdict>>(new Map());
  const [aiRateLimited, setAiRateLimited] = useState(false);
  useEffect(() => {
    if (!pick || pick.picks.length === 0) return;
    let alive = true;
    const targets = pick.picks.filter(p => p.role === "首选" || p.role === "接力").slice(0, 3);
    if (targets.length === 0) return;
    setAiMap(new Map());
    setAiRateLimited(false);
    (async () => {
      const rawByCode = new Map<string, ZTPoolItem>();
      for (const s of rawPool) rawByCode.set(String(s.c ?? ""), s);
      const results = await Promise.all(targets.map(p => {
        const raw = rawByCode.get(p.code);
        return decideForStock(
          {
            code: p.code, name: p.name, boardCount: p.boardCount,
            pct: raw?.zdp ?? 0,
            sealFund: raw?.fund ?? 0,
            amount: raw?.amount ?? 0,
            blastCount: raw?.zbc ?? 0,
            role: p.role,
          },
          { mainline: pick.mainline, stage: pick.stage },
        ).catch(() => null);
      }));
      if (!alive) return;
      const m = new Map<string, StockVerdict>();
      let rl = false;
      for (const r of results) {
        if (r) { m.set(r.code, r); if (r.rateLimited) rl = true; }
      }
      setAiMap(m);
      setAiRateLimited(rl);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick?.mainline, pick?.stage, pick?.picks?.length, rawPool]);

  if (!pick || pick.picks.length === 0) return null;

  return (
    <div className="rounded-xl border border-rose-500/25 bg-rose-950/10 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold text-rose-200">
          🎯 今日上车标的清单
          <span className="ml-1.5 text-[10px] text-slate-500 font-normal">主线「{pick.mainline}」{pick.stage} · {pick.ztCount}只涨停 · 最高{pick.height}板</span>
        </span>
        <div className="flex items-center gap-1">
          {pick.contend && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-300" title={pick.contend}>⚠ 卡位</span>}
          <DisclaimerTag />
        </div>
      </div>

      {/* v9.53（V7-11）：AI 配额受限 → 显式标注"本次非 AI" */}
      {aiRateLimited && (
        <div className="mb-2 rounded border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-[10px] font-bold text-rose-200">
          ⏸ AI 配额受限，标的研判为规则降级（非 AI 主导）
        </div>
      )}

      <div className="space-y-1.5">
        {pick.picks.map(p => (
          <div key={p.code} className="flex items-center gap-2 rounded-lg border border-white/5 bg-black/20 px-2.5 py-1.5">
            <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-black ${roleColor[p.role]}`}>{p.role}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-bold text-slate-100">{p.name}</span>
                <span className="text-[9px] text-slate-600">{p.code}</span>
                <span className="text-[9px] text-slate-500">{p.boardCount}板</span>
                <span className="rounded bg-white/5 px-1 py-px text-[9px] text-slate-400" title="涨停池轻量评分(封单30/连板25/换手20/炸板/首板)">分{p.pickScore}</span>
                {p.fundNote && <span className="truncate text-[9px] text-cyan-300/80">💧 {p.fundNote}</span>}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-400">
                {p.buyLogic} · <span className="text-amber-200/70">{p.entryStrategy}</span>
              </div>
              {/* v9.53（V7-2/10）：AI 一句话研判（逐标的） */}
              {(() => {
                const ai = aiMap.get(p.code);
                if (!ai) return <div className="mt-0.5 text-[9px] text-slate-600">🤖 AI 研判中…</div>;
                const vc = ai.verdict === "可买" ? "bg-emerald-500/20 text-emerald-300" : ai.verdict === "回避" ? "bg-rose-500/20 text-rose-300" : "bg-amber-500/20 text-amber-300";
                return (
                  <div className="mt-0.5 text-[10px]">
                    <span className={`mr-1 rounded px-1 py-px text-[9px] font-bold ${vc}`}>{ai.verdict}</span>
                    <span className="text-violet-300/90">{ai.reason}</span>
                    {ai.keyLevel && <span className="text-slate-500"> · 📌 {ai.keyLevel}</span>}
                    {ai.riskPoints.length > 0 && <span className="text-rose-300/70"> · ⚠ {ai.riskPoints.join("、")}</span>}
                  </div>
                );
              })()}
              {p.risks.length > 0 && (
                <div className="mt-0.5 text-[9px] text-rose-300/70">⚠ {p.risks.join(" · ")}</div>
              )}
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs font-black text-emerald-300">{p.suggestedPct}%</div>
              <div className="text-[9px] text-slate-500">仓位</div>
              <div className="mt-0.5 text-[9px] text-rose-300/80">止损{p.stopLoss}%</div>
            </div>
          </div>
        ))}
      </div>

      {pick.excluded.length > 0 && (
        <div className="mt-1.5 text-[9px] text-slate-600">
          已剔除 {pick.excluded.length} 只（{pick.excluded.map(e => `${e.name}(${e.reason})`).join("、")}）
        </div>
      )}
      <div className="mt-1.5 text-[9px] text-slate-600">
        💡 规则引擎按「龙一打板 → 龙二/三接力 → 首板低吸」分桶；仓位联动闸门（合计≤30%）；诱多/否决已剔除。仅供参考，不构成投资建议。
      </div>
    </div>
  );
}

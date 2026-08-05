// 今日主线作战卡（v9.16 打破重建）
// 核心变化：
//   1. 从"板块/个股/ETF 三列" → "主线排序（≥3条）"
//   2. 每个主线内嵌 龙一/龙二/龙三（涨停梯队直出）
//   3. ETF 按主线直出 + 风格感知排序
//   4. 顶部市场风格标签（进攻/轮动/防守）+ 风险偏好
//   5. LLM 精排逻辑 + 真主线 vs 脉冲判定

import { useState, useEffect } from "react";
import { fmtMoney } from "../lib/format";
import { stockRealUrl, etfRealUrl, boardNameRealUrl } from "../lib/realLinks";
import { getHitRateText } from "../lib/recTracker";
import type { GateResult } from "../lib/regimeGate";
import type { MarketStyleInfo } from "../lib/mainline";
import MainlineDiagnosisCard from "./MainlineDiagnosisCard";
import type { MainlineLLMResult } from "../lib/mainlineLLM";
import type { ETFScoreResult } from "../lib/etfScore";
import type { MainlineGroup } from "../lib/stockToMainline";

// ============== Props ==============
export interface BattlePlanData {
  gate: GateResult;
  /** LLM 归类后的主线候选（≥1条） */
  candidates: MainlineGroup[];
  /** LLM 精排结果（可能为 null=未调用或降级） */
  llmRanked: MainlineLLMResult[] | null;
  /** 市场风格 */
  marketStyle: MarketStyleInfo;
  /** ETF 排序（含主线直出标记） */
  etfs: ETFScoreResult[];
  /** 候选观察池：第4-8名板块 */
  candidateThemes?: Array<{ board: string; total: number; tier: "A" | "B" | "C" }>;
  /** LLM 归类总览（v9.17） */
  classifyOverview?: {
    totalStocks: number;
    mainlineCount: number;
    trueMainlineCount: number;
    logic: string;
  };
}

// ============== 风格徽标 ==============
function StyleBadge({ style }: { style: MarketStyleInfo }) {
  const cls = style.style === "attack" ? "bg-rose-500/20 text-rose-300"
    : style.style === "defense" ? "bg-sky-500/20 text-sky-300"
    : "bg-amber-500/20 text-amber-300";
  const icon = style.style === "attack" ? "🔥" : style.style === "defense" ? "🛡️" : "🔁";
  return (
    <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${cls}`}>
      {icon} {style.label} · 风险偏好{style.riskAppetite}
    </span>
  );
}

// ============== 主线区块（含龙一龙二龙三 + v9.23 强度分/离场/诊断） ==============
function MainlineBlock({ rank, name, ztCount, height, mainNet, leaders, logic, isPulse, caution, llm, strengthScore, exitSignal, exitSignalText, onDiagnose }: {
  rank: number;
  name: string;
  ztCount: number;
  height: number;
  mainNet: number;
  leaders: Array<{ code: string; name: string; role: string; reason: string; popularRank?: number; sealFund?: number; amount?: number }>;
  logic?: string;
  isPulse?: boolean;
  caution?: string;
  llm?: boolean;
  /** v9.23-1：主线强度分 0-100 */
  strengthScore?: number;
  /** v9.23-2：离场信号 */
  exitSignal?: boolean;
  exitSignalText?: string;
  /** v9.23-4：点击生成 AI 结构化诊断 */
  onDiagnose?: () => void;
}) {
  const rankColor = rank === 1 ? "border-rose-500/40 bg-rose-500/5" : rank === 2 ? "border-amber-500/30 bg-amber-500/5" : "border-slate-500/20 bg-white/5";
  const rankLabel = rank === 1 ? "🏆 第一主线" : rank === 2 ? "🥈 第二主线" : "🥉 第三主线";
  const rankText = rank === 1 ? "text-rose-300" : rank === 2 ? "text-amber-300" : "text-slate-300";
  // v9.17 强化：板块效应弱时（小涨停数）显示警示
  const weakEffect = ztCount < 3;
  // v9.23-1：强度分配色
  const strengthCls = strengthScore == null ? "" :
    strengthScore >= 80 ? "bg-rose-500/25 text-rose-300 border-rose-500/40" :
    strengthScore >= 60 ? "bg-amber-500/20 text-amber-300 border-amber-500/30" :
    "bg-slate-500/20 text-slate-400 border-slate-500/30";
  // v9.23.1-fix：强度分 <60 主线卡片默认折叠（PRD A2）
  // v9.26.10：useState 初值仅挂载生效 → 强度分变化后不同步；改为随强度分同步（用户手动展开优先）
  const [collapsed, setCollapsed] = useState(strengthScore != null && strengthScore < 60);
  useEffect(() => {
    setCollapsed(strengthScore != null && strengthScore < 60);
  }, [strengthScore != null && strengthScore < 60]);
  return (
    <div className={`rounded-lg border p-2.5 ${rankColor}`}>
      <div className="flex items-center justify-between flex-wrap gap-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-black ${rankText}`}>{rankLabel}</span>
          <span className="text-sm font-bold text-slate-100">{name}</span>
          {isPulse && <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-slate-500/20 text-slate-400">💨 脉冲/孤峰</span>}
          {weakEffect && ztCount > 0 && !isPulse && (
            <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-amber-500/20 text-amber-300">板块效应弱</span>
          )}
          {llm && <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-violet-500/20 text-violet-300">LLM</span>}
          {/* v9.23-1：强度分大字号徽章 */}
          {strengthScore != null && (
            <span className={`rounded border px-1.5 py-0.5 text-[12px] font-black ${strengthCls}`} title="主线强度分（PRD 6.1：涨停占比25+连板20+晋级率15+资金20+换手10+催化10）">
              {strengthScore}分
            </span>
          )}
          {/* v9.23-2：离场信号 */}
          {exitSignal && (
            <span className="rounded border border-rose-500/50 bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-black text-rose-300" title={exitSignalText}>
              ⚠ 退潮
            </span>
          )}
          {/* v9.23.1-fix：折叠按钮（<60 默认折叠，点击展开） */}
          {strengthScore != null && strengthScore < 60 && (
            <button onClick={() => setCollapsed(v => !v)}
              className="rounded bg-slate-500/20 px-1.5 py-0.5 text-[9px] text-slate-400 hover:bg-slate-500/30">
              {collapsed ? "▸ 展开" : "▾ 折叠"}
            </button>
          )}
        </div>
        <div className="flex gap-1.5 text-[10px] text-slate-400">
          {/* v9.21-C：开盘啦式热度条 */}
          <span className="rounded bg-black/30 px-1.5 py-0.5" title="该主线今日涨停家数">
            🔥 <b className="text-rose-300">{ztCount}</b> 涨停
          </span>
          <span className="rounded bg-black/30 px-1.5 py-0.5" title="最高连板">
            <b className="text-amber-300">{height}</b>板
          </span>
          <span className="rounded bg-black/30 px-1.5 py-0.5" title="涨停数-龙头数=跟风数（跟风越少说明梯队越紧凑）">
            跟风 <b className="text-slate-300">{Math.max(0, ztCount - (leaders.length > 0 ? 1 : 0))}</b>
          </span>
          <span className={`rounded bg-black/30 px-1.5 py-0.5 ${mainNet >= 0 ? "text-rose-300" : "text-emerald-300"}`} title="板块主力净流入">
            资金 {fmtMoney(mainNet)}
          </span>
          {/* v9.23-4：AI 结构化诊断按钮 */}
          {onDiagnose && (
            <button onClick={onDiagnose}
              className="rounded bg-violet-500/20 px-1.5 py-0.5 text-violet-200 hover:bg-violet-500/30" title="生成该主线的 AI 结构化诊断卡">
              🎯 诊断
            </button>
          )}
        </div>
      </div>

      {/* 龙一龙二龙三（v9.17-fix：人气榜对照徽标） */}
      <div className="mt-1.5 space-y-1">
        {leaders.length === 0 && <div className="text-[11px] text-slate-500">涨停梯队数据积累中</div>}
        {leaders.map((l, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span className={`w-8 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-bold ${
              l.role === "龙一" ? "bg-rose-500/20 text-rose-300"
              : l.role === "龙二" ? "bg-amber-500/20 text-amber-300"
              : "bg-slate-500/20 text-slate-300"
            }`}>{l.role}</span>
            <a href={stockRealUrl(l.code)} target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-100 hover:text-amber-300">
              {l.name}
            </a>
            <span className="text-slate-500">{l.code}</span>
            {/* 人气榜徽标：人气 Top10 高亮 */}
            {l.popularRank != null && l.popularRank > 0 && (
              <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${
                l.popularRank <= 3 ? "bg-rose-500/20 text-rose-300" : "bg-amber-500/15 text-amber-300"
              }`}>🔥人气#{l.popularRank}</span>
            )}
            <span className="text-slate-500 truncate">{l.reason}</span>
          </div>
        ))}
      </div>

      {/* LLM 逻辑 */}
      {logic && (
        <div className="mt-1.5 rounded bg-black/20 px-2 py-1 text-[10px] text-slate-400 leading-relaxed">
          📌 {logic}
          {caution && <span className="ml-1 text-amber-400">⚠️ {caution}</span>}
        </div>
      )}
    </div>
  );
}

// ============== 个股候选池（非涨停，资金共振） ==============
function CandidatePool({ themes }: { themes: BattlePlanData["candidateThemes"] }) {
  const [open, setOpen] = useState(false);
  if (!themes || themes.length === 0) return null;
  return (
    <div>
      <button onClick={() => setOpen(v => !v)} className="text-[11px] text-slate-500 hover:text-slate-400">
        {open ? "▲ 收起候选观察池" : "▼ 候选观察池（轮动备选）"}
      </button>
      {open && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {themes.map(t => (
            // v9.26.13：板块名点击跳板块详情页
            <a key={t.board} href={boardNameRealUrl(t.board)} target="_blank" rel="noopener noreferrer"
               className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/15 hover:border-white/30 cursor-pointer">
              {t.board} <b className="text-slate-400">{t.total}</b>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ============== ETF 排序区 ==============
function ETFBlock({ etfs }: { etfs: ETFScoreResult[] }) {
  if (etfs.length === 0) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
      <div className="text-[11px] font-bold text-emerald-300 mb-1.5">💰 ETF 排序（风格感知 + 主线直出）</div>
      <div className="space-y-1">
        {etfs.slice(0, 4).map((e, i) => (
          // v9.26.13：整行可点击跳 ETF 详情页
          <a key={e.code} href={etfRealUrl(e.code)} target="_blank" rel="noopener noreferrer"
             className="flex items-center gap-2 text-[11px] hover:bg-white/5 rounded px-1 -mx-1 cursor-pointer">
            <span className={`w-5 text-center font-black ${i === 0 ? "text-emerald-300" : "text-slate-500"}`}>{i + 1}</span>
            <span className="font-semibold text-slate-100">{e.name}</span>
            {e.fromMainline && e.matchedMainline && (
              <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-emerald-500/20 text-emerald-300">主线直出</span>
            )}
            <span className="ml-auto text-slate-500 text-[10px]">{e.code}</span>
            <span className={`font-black ${e.total >= 70 ? "text-emerald-300" : e.total >= 55 ? "text-amber-300" : "text-slate-400"}`}>{e.total}</span>
          </a>
        ))}
      </div>
      <div className="mt-1 text-[10px] text-slate-600">
        评分 = 资金趋势30% + 板块联动25% + 风格适配20% + 主线直出15% + 宏观10% · 点击跳详情
      </div>
    </div>
  );
}

// ============== 主组件 ==============
export default function BattlePlan({ data }: { data: BattlePlanData | null }) {
  if (!data) return null;

  const { gate, candidates, llmRanked, marketStyle, etfs, candidateThemes, classifyOverview } = data;
  const isEmpty = candidates.length === 0;
  // v9.23-4：当前诊断的主线（点击"诊断"按钮时设置）
  const [diagMainline, setDiagMainline] = useState<string | null>(null);

  // LLM 精排结果 vs 规则机候选 合并展示
  const display: Array<{
    board: string; ztCount: number; height: number; mainNet: number;
    leaders: Array<{ code: string; name: string; role: string; reason: string; popularRank?: number; sealFund?: number; amount?: number }>;
    logic?: string; isPulse?: boolean; caution?: string; llm?: boolean;
    strengthScore?: number; exitSignal?: boolean; exitSignalText?: string;
  }> = [];
  if (llmRanked && llmRanked.length > 0) {
    for (const r of llmRanked) {
      display.push({
        board: r.board, ztCount: 0, height: 0, mainNet: 0,
        leaders: r.leaders,
        logic: r.logic, isPulse: r.isPulse, caution: r.caution, llm: r.fromLLM,
      });
    }
  } else {
    for (const c of candidates) {
      display.push({
        board: c.mainline, ztCount: c.ztCount, height: c.height, mainNet: c.mainNet,
        leaders: c.leaders,
        strengthScore: c.strengthScore,
        exitSignal: c.exitSignal,
        exitSignalText: c.exitSignalText,
      });
    }
  }

  // 补齐 ztCount/height/mainNet（从 candidates 按 mainline 匹配）
  const candMap = new Map(candidates.map(c => [c.mainline, c]));
  // v9.17-fix: LLM 精排 leaders 可能只有龙一（LLM 只返回1个）→ 用规则机候选补齐龙二龙三
  for (const d of display) {
    const c = candMap.get(d.board);
    if (c) {
      d.ztCount = c.ztCount; d.height = c.height; d.mainNet = c.mainNet;
      // v9.23：强度分/离场信号从候选复制（LLM 精排不返回这些字段）
      if (d.strengthScore == null) d.strengthScore = c.strengthScore;
      if (d.exitSignal == null) d.exitSignal = c.exitSignal;
      if (d.exitSignalText == null) d.exitSignalText = c.exitSignalText;
      // 补齐缺失的龙二龙三（LLM 没返回时用规则机排序）
      if (d.leaders.length < 3 && c.leaders.length > d.leaders.length) {
        const llmCodes = new Set(d.leaders.map(l => l.code));
        for (const cl of c.leaders) {
          if (d.leaders.length >= 3) break;
          if (!llmCodes.has(cl.code)) {
            d.leaders.push({ code: cl.code, name: cl.name, role: cl.role, reason: cl.reason, popularRank: cl.popularRank });
          }
        }
        // 角色排序保证 龙一/龙二/龙三 顺序
        d.leaders.sort((a, b) => {
          const order = (r: string) => r.includes("龙一") ? 0 : r.includes("龙二") ? 1 : 2;
          return order(a.role) - order(b.role);
        });
      }
      // 人气榜 rank 从候选复制（LLM 只给龙一时）
      for (const dl of d.leaders) {
        if (dl.popularRank == null) {
          const cl = c.leaders.find(x => x.code === dl.code);
          if (cl) dl.popularRank = cl.popularRank;
        }
      }
    }
  }

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4 space-y-3">
      {/* 头部：闸门 + 风格 + 模式 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-amber-200">⚔️ 今日主线作战卡</span>
          <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${
            gate.factor != null && gate.factor >= 0.8 ? "bg-emerald-500/20 text-emerald-300" :
            gate.factor != null && gate.factor >= 0.5 ? "bg-amber-500/20 text-amber-300" :
            "bg-rose-500/20 text-rose-300"
          }`}>
            闸门×{gate.factor != null ? gate.factor.toFixed(1) : "—"} {gate.label}
          </span>
          <StyleBadge style={marketStyle} />
        </div>
        {gate.reason.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {gate.reason.map((r, i) => (
              <span key={i} className="rounded px-1 py-0.5 text-[10px] bg-rose-500/20 text-rose-300">🔥 {r}</span>
            ))}
          </div>
        )}
      </div>

      {/* 低闸门警示 */}
      {gate.mode === "low" && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
          ⚠️ <b>低闸门模式（闸门×{gate.factor?.toFixed(1)}）</b> —— 历史统计中该环境下主线成功率偏低，以下内容仅作观察，请谨慎。
        </div>
      )}

      {/* v9.17 LLM 归类总览 */}
      {classifyOverview && classifyOverview.mainlineCount > 0 && (
        <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-1.5 text-[11px] text-violet-200">
          🤖 <b>LLM 归类</b>：{classifyOverview.totalStocks}只涨停 → {classifyOverview.mainlineCount}条主线（{classifyOverview.trueMainlineCount}条真主线）
          {classifyOverview.logic && <span className="text-violet-300/80 ml-1">· {classifyOverview.logic.slice(0, 80)}</span>}
        </div>
      )}

      {/* 主线区块（≥3条） */}
      {!isEmpty ? (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {display.slice(0, 4).map((d, i) => (
            <MainlineBlock
              key={d.board + i}
              rank={i + 1}
              name={d.board}
              ztCount={d.ztCount}
              height={d.height}
              mainNet={d.mainNet}
              leaders={d.leaders}
              logic={d.logic}
              isPulse={d.isPulse}
              caution={d.caution}
              llm={d.llm}
              strengthScore={d.strengthScore}
              exitSignal={d.exitSignal}
              exitSignalText={d.exitSignalText}
              onDiagnose={() => setDiagMainline(d.board)}
            />
          ))}
          {display.length < 3 && (
            <div className="rounded-lg border border-dashed border-white/10 p-3 text-center text-[11px] text-slate-500">
              主线不足 3 条，市场缺乏清晰主线
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-4 text-sm text-slate-400">
          今日无涨停潮（涨停家数不足或数据缺失）
        </div>
      )}

      {/* ETF 排序 */}
      <ETFBlock etfs={etfs} />

      {/* v9.23-4：AI 主线诊断卡（点击"诊断"按钮后显示） */}
      {diagMainline && (() => {
        const c = candMap.get(diagMainline);
        if (!c) return null;
        return (
          <MainlineDiagnosisCard mainline={c} onClose={() => setDiagMainline(null)} />
        );
      })()}

      {/* 候选观察池 */}
      <CandidatePool themes={candidateThemes} />

      {/* 归因命中率 */}
      <div className="border-t border-white/10 pt-1.5 text-[11px] text-slate-500 text-center">
        📊 {getHitRateText()}
      </div>
    </div>
  );
}

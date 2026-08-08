// 游资五问条（v9.23-3，PRD 5.1-A1）
// 驾驶舱顶部常驻 5 卡片横排：主线/阶段/龙头/操作/离场信号
// 价值主张："3 秒告诉我今天最强的主线是什么、现在是什么阶段、我该不该上车、什么时候该跑"
// 60 秒自动刷新；v9.28（P1-5）：第4问"操作"改用最终准入闸（强度×阶段×闸门×梯队）
import { useState, useEffect } from "react";
import type { BattlePlanData } from "./BattlePlan";
import { STRENGTH_META } from "../lib/mainlineScore";
import { evaluateAdmission } from "../lib/admissionGate";
import { stageOfStrength, classifyStage } from "../lib/stageModel";
import DisclaimerTag from "./DisclaimerTag";
// v9.34（S2）：市场状态机（幻方"状态自适应"思想落地）
import { classifyMarketState, MARKET_STATE_META, type MarketStateResult } from "../lib/marketStateMachine";
// v9.77（P0-1 修复）：读取"昨日涨停数"真实快照，替代传 null（原 null → ztYoY 恒 null → 退潮/分歧分支永不触发）
import { loadPrevZTSnapshot } from "../lib/ztSnapshot";
import type { OverviewData, FundStructureData } from "../App";

interface Props {
  battlePlan: BattlePlanData | null;
  /** v9.34（S2）：市场状态机输入（情绪/涨停/炸板/溢价） */
  overview?: OverviewData | null;
  /** v9.77（P0-1 修复）：资金结构（真实主力净占比，替代伪造 0/1 代理） */
  fund?: FundStructureData | null;
}

export default function FiveQBar({ battlePlan, overview, fund }: Props) {
  const [, setTick] = useState(0);
  // 60s 自动刷新（v9.23-A1）
  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 60000);
    return () => clearInterval(t);
  }, []);

  // v9.34（S2）：市场状态机 —— 回答"今天是什么市"，联动五问条情绪判断
  const marketState: MarketStateResult | null = overview
    ? classifyMarketState({
        sentiment: overview.sentiment ?? 50,
        ztCount: overview.limitPool?.limitUpCount ?? 0,
        dtCount: overview.limitPool?.limitDownCount ?? 0,
        blastedRate: overview.limitPool?.blastedRate ?? 0,
        premiumAvg: overview.premiumAvg ?? null,
        maxBoardHeight: overview.maxBoardHeight ?? null,
      })
    : null;
  const stateMeta = marketState ? MARKET_STATE_META[marketState.state] : null;

  // 取最强主线（强度分最高，优先看 score/ztCount 兜底）
  const candidates = battlePlan?.candidates ?? [];
  const top = candidates.length > 0 ? candidates[0] : null;
  const topMainline = top?.mainline ?? "—";
  const topScore = top?.strengthScore ?? 0;
  const topStage = battlePlan?.marketStyle?.label ?? "—";

  // v9.37（V3-P1）：市场级阶段（classifyStage 综合判定：涨停环比/炸板/晋级率/高度/资金）
  // v9.77（P0-1 修复）：此前 ztCountYesterday 恒 null、mainNetPct 用 totalBoardStocks?1:0 伪造，
  //   导致退潮(ztYoY<-0.3&&mainNetPct<0)/分歧/启动/发酵分支全部失真，退潮日可能误报"启动期"。
  //   现在昨日涨停数读真实快照（loadPrevZTSnapshot(qdate) 找 qdate 之前最近一条），
  //   主力净占比用 真实今日主力净额 / 两市成交额（fund 数据，缺失则 null → 相关分支不误触发）。
  const prevPool = overview?.limitPool?.qdate ? loadPrevZTSnapshot(overview.limitPool.qdate) : null;
  const ztCountYesterday = prevPool?.length ?? null;
  const turnoverAmt = fund?.turnoverAmount ?? 0;
  const todayMainNet = fund?.structure?.today?.mainNet ?? null;
  const mainNetPct = turnoverAmt > 0 && todayMainNet != null ? (todayMainNet / turnoverAmt) * 100 : null;
  const marketStageVerdict = overview ? classifyStage({
    ztCountToday: overview.limitPool?.limitUpCount ?? 0,
    ztCountYesterday,
    heightToday: overview.maxBoardHeight ?? 0,
    blastedRateToday: overview.limitPool?.blastedRate ?? null,
    promotionRate: overview.promotionRate ?? null,
    // 数据缺失时传 0（非正非负）→ 资金相关分支（退潮/高潮/发酵/启动）不误触发，落"分歧/观察中"而非伪造阶段
    mainNetPct: mainNetPct ?? 0,
    mainNet5dPct: undefined,
  }) : null;
  const marketStageLabel = marketStageVerdict?.stage ?? topStage;

  // v9.28（P1-5）：操作徽章基于最终准入闸（强度×阶段×闸门×梯队×诱多）
  const admission = evaluateAdmission({
    strengthScore: top?.strengthScore ?? null,
    stage: top ? stageOfStrength({ strengthScore: top.strengthScore, ztCount: top.ztCount, exitSignal: top.exitSignal }) : "观察中",
    gateMode: battlePlan?.gate?.mode ?? "empty",
    ztCount: top?.ztCount ?? 0,
    height: top?.height ?? 0,
  });
  let action = admission.action;
  let actionColor = "bg-slate-500/20 text-slate-400 border-slate-500/30";
  if (!top) {
    action = "观望";
  } else if (admission.action === "禁止") {
    actionColor = "bg-rose-500/25 text-rose-300 border-rose-500/40";
  } else if (admission.action === "可上车") {
    actionColor = "bg-emerald-500/25 text-emerald-300 border-emerald-500/40";
  } else {
    actionColor = "bg-amber-500/25 text-amber-300 border-amber-500/40";
  }

  const strengthMeta = STRENGTH_META[topScore >= 80 ? "gold" : topScore >= 60 ? "silver" : "bronze"];

  // v9.26 A.3：三态输出（唯一可交易 / 多主线轮动 / 无可交易）—— 避免"无论如何给第一名"
  // 规则：Top1 强度≥60 且 与 Top2 分差≥10 → 唯一可交易；分差<10 → 轮动；无合格 → 无可交易
  const top2Score = candidates[1]?.strengthScore ?? candidates[1]?.score ?? 0;
  const gapOk = top && (topScore - top2Score) >= 10;
  const qualified = top && topScore >= 60 && (top?.strengthCompleteness ?? 1) >= 0.5;
  let mainlineState: { label: string; cls: string; desc: string };
  if (!top || !qualified) {
    mainlineState = { label: "无可交易主线", cls: "text-slate-500", desc: "强度不足或数据缺失，只观察" };
  } else if (gapOk) {
    mainlineState = { label: `唯一可交易：${topMainline}`, cls: "text-rose-300", desc: `Top2 ${top2Score}分，分差${Math.round(topScore - top2Score)}分` };
  } else {
    mainlineState = { label: "多主线轮动", cls: "text-amber-300", desc: `Top1 ${topScore} / Top2 ${top2Score}，分差<10` };
  }

  return (
    <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-5">
      {/* 0. 市场状态（v9.34 S2：幻方"状态自适应"——先判今天是什么市） */}
      {marketState && stateMeta && (
        <div className={`rounded-lg border p-2 ${stateMeta.color.split(" ").slice(0, 2).join(" ")}`}>
          <div className="text-xs text-slate-500">🏛️ 市场状态</div>
          <div className="mt-0.5 text-xs font-black truncate" title={`置信 ${marketState.confidence}% · ${marketState.evidence.join(" · ")}`}>
            {stateMeta.icon} {marketState.state}
            <span className="ml-1 rounded bg-black/20 px-1 py-0.5 text-xs font-bold">
              仓位{Math.round(marketState.positionFactor * 100)}%
            </span>
          </div>
          <div className="text-xs text-slate-500 truncate" title={marketState.playbook}>
            {marketState.playbook}
          </div>
        </div>
      )}

      {/* 1. 主线是什么（v9.26 A.3 三态：唯一可交易/多主线轮动/无可交易） */}
      {/* v10-8（P2）：第一问（最强主线名）放大 —— 今天最强主线是"第一优先级"信息 */}
      <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2">
        <div className="text-xs text-slate-500">1️⃣ 主线是什么</div>
        <div className={`mt-0.5 text-xl font-black truncate ${mainlineState.cls}`} title={mainlineState.desc}>
          {mainlineState.label}
          {top && <span className={`ml-1.5 rounded px-1.5 py-0.5 text-sm font-black ${strengthMeta.color}`}>{topScore}分</span>}
        </div>
        <div className="text-xs text-slate-500" title={mainlineState.desc}>
          {mainlineState.desc}
          {top && top.strengthMissing && top.strengthMissing.length > 0 && (
            <span className="text-amber-400/80"> 缺:{top.strengthMissing.join("/")}</span>
          )}
        </div>
      </div>

      {/* 2. 处于什么阶段 */}
      <div className="rounded-lg border border-white/10 bg-white/5 p-2">
        <div className="text-xs text-slate-500">2️⃣ 处于什么阶段</div>
        <div className="mt-0.5 text-xs font-bold text-amber-300 truncate">{marketStageLabel}</div>
        <div className="text-xs text-slate-500">{battlePlan?.gate?.label ?? "—"}</div>
      </div>

      {/* 3. 谁是龙头 */}
      {/* v11-2（P0）：龙头放大 text-lg font-black + 主线名兜底（不再只有"—"）+ 板数/理由 */}
      <div className="rounded-lg border border-white/10 bg-white/5 p-2">
        <div className="text-xs text-slate-500">3️⃣ 谁是龙头</div>
        <div className="mt-0.5 text-lg font-black text-amber-200 truncate">
          {top?.leaders[0]?.name ?? top?.mainline?.slice(0, 4) ?? "—"}
          <span className="text-xs text-slate-500 ml-1">{top?.leaders[0]?.code ?? ""}</span>
        </div>
        <div className="text-xs text-slate-400">
          {top?.leaders[0]
            ? `${top.leaders[0].boardCount ? top.leaders[0].boardCount + "板 · " : ""}${top.leaders[0].reason?.slice(0, 16) ?? ""}`
            : top?.leaders && top.leaders.length > 0
            ? `${top.leaders.length}只梯队`
            : "梯队数据积累中"}
        </div>
      </div>

      {/* 4. 能不能上车 */}
      <div className="rounded-lg border border-white/10 bg-white/5 p-2">
        <div className="text-xs text-slate-500">4️⃣ 能不能上车</div>
        <div className={`mt-0.5 inline-block rounded border px-1.5 py-0.5 text-[11px] font-black ${actionColor}`}>
          {action}
          {admission.pass && <span className="ml-1 text-xs font-normal opacity-80">置信 {admission.confidence}%</span>}
        </div>
        <div className="text-xs text-slate-500 mt-0.5 truncate" title={admission.pass ? admission.reasons.join("；") : admission.blockers.join("；")}>
          {admission.pass ? admission.reasons.join("；") : (admission.blockers[0] ?? "—")}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          闸门×{battlePlan?.gate?.factor?.toFixed(1) ?? "—"}
          <DisclaimerTag />
        </div>
      </div>

      {/* 5. 什么时候跑 */}
      <div className="rounded-lg border border-white/10 bg-white/5 p-2">
        <div className="text-xs text-slate-500">5️⃣ 什么时候跑</div>
        {top?.exitSignal ? (
          <div className="mt-0.5 text-[11px] font-bold text-rose-400">⚠ 已触发</div>
        ) : (
          <div className="mt-0.5 text-[11px] font-bold text-emerald-400">✓ 尚未触发</div>
        )}
        <div className="text-xs text-slate-500 truncate" title={top?.exitSignalText ?? ""}>
          {top?.exitSignalText ?? "持续监控炸板率/晋级率"}
        </div>
      </div>
    </div>
  );
}

// 主线诊断卡（v9.23-4，PRD 7.2 mainline_diagnosis schema）
// 真实 LLM 优先（mainlineDiagnosis 任务槽）→ 失败降级规则引擎（强度分+离场信号）
// 结构化输出：结论/理由/风险/置信度分行，禁止大段文字
import { useState, useEffect } from "react";
import { callAI } from "../lib/ai";
import { setAIResult } from "../lib/aiConclusionStore";
import { parseLLMJSON, schemaForTask } from "../lib/llmJson";
import { calcMainlineStrength } from "../lib/mainlineScore";
import { checkExitSignal } from "../lib/exitSignal";
import type { MainlineGroup } from "../lib/stockToMainline";
import DisclaimerTag from "./DisclaimerTag";
import AskAI from "./AskAI";

// ============== 结构化输出（PRD 7.2） ==============
export interface MainlineDiagnosis {
  type: "mainline_diagnosis";
  mainline: string;
  strength_score: number;
  stage: string;
  sustain_forecast: string;
  leader: {
    core: string[];
    follower: string[];
    hype: string[];
  };
  /** 操作信号（中性表述，合规）：偏强/中性/偏弱/离场 */
  action: string;
  risk: string[];
  exit_signal_triggered: boolean;
  confidence: number;
  /** v9.99.2（B4）：true = 规则引擎兜底产出（LLM 失败/解析失败），渲染加"规则版"角标，用户不得误认 AI 诊断 */
  degraded?: boolean;
}

interface Props {
  mainline: MainlineGroup;
  onClose: () => void;
}

/**
 * v9.92.3-fix（用户报障：诊断"新能源车"却输出医药股核心）：LLM leader 输出硬约束。
 * 核心/跟风/蹭热点只能引用输入 leaders 名单内的股票名（防幻觉），剔除后为空用输入 leaders 兜底。
 */
export function constrainLeaders(
  leaders: Array<{ name: string }>,
  core?: string[],
  follower?: string[],
  hype?: string[],
): { core: string[]; follower: string[]; hype: string[] } {
  const known = new Set(leaders.map(l => l.name));
  const clean = (arr: string[] | undefined): string[] =>
    Array.isArray(arr) ? arr.filter(n => known.has(n)) : [];
  const coreC = clean(core);
  const followerC = clean(follower);
  const hypeC = clean(hype);
  const fallbackNames = leaders.map(l => l.name);
  return {
    core: coreC.length > 0 ? coreC : fallbackNames.slice(0, 1),
    follower: followerC.length > 0 ? followerC : fallbackNames.slice(1, 3),
    hype: hypeC.length > 0 ? hypeC : [],
  };
}

export default function MainlineDiagnosisCard({ mainline, onClose }: Props) {
  const [diagnosis, setDiagnosis] = useState<MainlineDiagnosis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildPrompt = (): string => {
    const leadersText = mainline.leaders.map(l => `${l.role} ${l.name}(${l.code}) ${l.reason}`).join("；");
    return `你是资深A股游资操盘手，擅长盘中第一时间判断最强主线。
基于以下实时数据：
- 主线：${mainline.mainline}
- 涨停${mainline.ztCount}家，最高${mainline.height}板
- 龙一龙二龙三：${leadersText}
- 板块涨幅${mainline.boardPct}%，资金${(mainline.mainNet / 1e8).toFixed(1)}亿
- 强度分：${mainline.strengthScore ?? "—"}
- LLM归因：${mainline.logic}
- 风险提示：${mainline.caution}

请按以下JSON结构输出对「${mainline.mainline}」的诊断（只输出JSON）：
{
  "type":"mainline_diagnosis",
  "mainline":"${mainline.mainline}",
  "strength_score": 0-100,
  "stage":"启动/加速/主升分歧/退潮/冰点 四选一",
  "sustain_forecast":"预计可持续X个交易日，置信度Y%（基于历史样本假设）",
  "leader":{"core":["核心逻辑股"],"follower":["跟风股"],"hype":["蹭热点股"]},
  "action":"信号偏强/信号中性/信号偏弱/离场信号 四选一",
  "risk":["最多2条，按重要性排序"],
  "exit_signal_triggered": true或false,
  "confidence": 0-100
}
要求：结论先行，语言简练，禁止模糊词汇（如"或许""可能"），
必须给出明确判断。若数据不足以支撑判断，confidence需低于50并说明缺失数据。
所有内容为数据统计参考，不构成投资建议。`;
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await callAI("mainlineDiagnosis", { prompt: buildPrompt() });
      if (!result.degraded) {
        const parsed = parseLLMJSON<MainlineDiagnosis>(result.text, schemaForTask("mainlineDiagnosis"));
        if (parsed && parsed.mainline && parsed.strength_score != null) {
          // v9.92.3-fix（用户报障）：诊断"新能源车"却输出医药股核心 —— LLM 幻觉。
          // 硬约束：leader 字段只能引用输入数据（mainline.leaders 名单），见 constrainLeaders
          const ldr = (parsed as { leader?: { core?: string[]; follower?: string[]; hype?: string[] } }).leader;
          setDiagnosis({ ...parsed, leader: constrainLeaders(mainline.leaders, ldr?.core, ldr?.follower, ldr?.hype) });
          // v9.93.3：诊断结论登记全站 store（AI 诊断列/复盘 prompt 可引用；不覆盖旧值仅刷新）
          try { setAIResult("themeDiagnosis", mainline.mainline, { stage: parsed.stage, action: parsed.action, confidence: parsed.confidence, sustain_forecast: parsed.sustain_forecast, risk: parsed.risk, ts: Date.now() }, "diagnosis"); } catch { /* 静默 */ }
          return;
        }
        console.warn("[MainlineDiagnosis] JSON 解析失败，降级规则引擎:", result.text.slice(0, 200));
      }
      // 降级：规则引擎（强度分 + 离场信号）
      // v9.137.0（审查 P3-09）：全市场涨停数真实化 —— 原固定 "ztCount*3 近似"（非真实值，
      //   ztRatio 因子恒 33 分失真）；现优先取认知层/PG 快照的真实涨停总数，取不到才用近似。
      let realTotalZt: number | null = null;
      try {
        const r = await fetch("/api/cognition", { signal: AbortSignal.timeout(4000) });
        if (r.ok) {
          const j = await r.json();
          const n = Number(j?.sentiment?.value?.limitScore);
          if (Number.isFinite(n) && n > 0) realTotalZt = n;
        }
      } catch { /* 认知层不可用 */ }
      if (realTotalZt == null) {
        try {
          const { fetchMarketSnapshot } = await import("../lib/dataLayer");
          const snap = await fetchMarketSnapshot();
          const n = Number(snap?.data?.market?.ztCount);
          if (Number.isFinite(n) && n > 0) realTotalZt = n;
        } catch { /* PG 快照不可用 */ }
      }
      const strength = calcMainlineStrength({
        ztCount: mainline.ztCount,
        totalZtCount: realTotalZt ?? Math.max(mainline.ztCount * 3, 30), // 真实值优先；取不到才 3× 近似（诚实标注见 evidence）
        height: mainline.height,
        totalMaxHeight: Math.max(mainline.height, 2),
        promotionRate: null,
        mainNet5d: mainline.mainNet5d,
        mainNet10d: null,
        boardPct: mainline.boardPct,
        turnoverRate: null,
        catalystStrength: null,
      });
      const exit = checkExitSignal({
        mainline: mainline.mainline,
        ztCountToday: mainline.ztCount,
        ztCountYesterday: null,
        heightToday: mainline.height,
        heightYesterday: null,
        blastedRateToday: null,
        blastedRateYesterday: null,
        mainNetToday: mainline.mainNet,
        mainNetYesterday: null,
      });
      setDiagnosis({
        type: "mainline_diagnosis",
        mainline: mainline.mainline,
        strength_score: strength.score,
        stage: mainline.isPulse ? "分歧" : strength.score >= 80 ? "加速" : strength.score >= 60 ? "启动" : "退潮",
        sustain_forecast: "基于规则引擎假设，非真实回测",
        leader: {
          core: mainline.leaders.slice(0, 1).map(l => `${l.name} ${l.code}`),
          follower: mainline.leaders.slice(1, 3).map(l => `${l.name} ${l.code}`),
          hype: [],
        },
        action: exit.triggered ? "离场信号" : strength.score >= 80 ? "信号偏强" : strength.score >= 60 ? "信号中性" : "信号偏弱",
        risk: [exit.text || mainline.caution].filter(Boolean).slice(0, 2),
        exit_signal_triggered: exit.triggered,
        confidence: Math.min(70, 40 + strength.score / 10),
        degraded: true, // v9.99.2（B4）：规则引擎兜底 → 渲染标"规则版"，不伪装 AI
      });
    } catch (e) {
      setError("诊断生成失败");
    } finally {
      setLoading(false);
    }
  };

  // 首次挂载自动加载（v9.23-fix：useState 初始值函数不能有副作用，改 useEffect）
  useEffect(() => { load(); }, []);

  return (
    <div className="rounded-lg border border-violet-500/30 bg-violet-950/10 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-violet-300">🎯 主线诊断 · {mainline.mainline}</span>
          {/* v9.99.2（B4）：规则引擎兜底时显式标注，不伪装 AI 诊断 */}
          {diagnosis?.degraded && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300" title="LLM 不可用/解析失败，当前为规则引擎兜底输出">⚡ 规则引擎版</span>
          )}
          {diagnosis && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${
              diagnosis.strength_score >= 80 ? "bg-rose-500/25 text-rose-300" :
              diagnosis.strength_score >= 60 ? "bg-amber-500/20 text-amber-300" :
              "bg-slate-500/20 text-slate-400"
            }`}>
              {diagnosis.strength_score}分
            </span>
          )}
          <DisclaimerTag />
        </div>
        <button onClick={onClose} className="text-slate-600 hover:text-rose-400 text-xs">✕</button>
      </div>

      {loading && <div className="text-[10px] text-slate-500">AI 分析中…</div>}
      {error && <div className="text-[10px] text-rose-400">{error}</div>}

      {diagnosis && (
        <div className="space-y-1 text-[11px]">
          {/* v9.92.2-fix（用户报障）：MAINLINE_DIAGNOSIS schema 中 risk 是 string（LLM 按 schema 返回），
              原渲染当数组 join → "n.risk.join is not a function" 崩溃；leader 对象也可能缺失/结构不同。
              统一防御：数组直接用，string 按分隔符拆，缺失给空数组 */}
          {(() => {
            const r = diagnosis.risk as unknown;
            const risks = Array.isArray(r) ? r as string[]
              : (typeof r === "string" && r.trim() ? r.split(/[；;，,]/).map(x => x.trim()).filter(Boolean) : []);
            const ldr = (diagnosis as { leader?: { core?: unknown; follower?: unknown; hype?: unknown } }).leader;
            const core = Array.isArray(ldr?.core) ? ldr.core as string[] : [];
            const follower = Array.isArray(ldr?.follower) ? ldr.follower as string[] : [];
            const hype = Array.isArray(ldr?.hype) ? ldr.hype as string[] : [];
            return (
              <>
                {core.length > 0 && <div className="text-slate-500">核心：{core.join("、")}</div>}
                {follower.length > 0 && <div className="text-slate-600">跟风：{follower.join("、")}</div>}
                {hype.length > 0 && <div className="text-slate-600">蹭热点：{hype.join("、")}</div>}
                {risks.length > 0 && <div className="text-rose-300/90">⚠ 风险：{risks.join("；")}</div>}
              </>
            );
          })()}
          <div className="flex gap-2 flex-wrap">
            <span className="rounded bg-black/30 px-1.5 py-0.5 text-slate-300">阶段：<b className="text-amber-300">{diagnosis.stage}</b></span>
            <span className="rounded bg-black/30 px-1.5 py-0.5 text-slate-300">
              操作：<b className={diagnosis.action.includes("离场") ? "text-rose-400" : diagnosis.action.includes("偏强") ? "text-emerald-400" : "text-amber-300"}>{diagnosis.action}</b>
            </span>
            <span className="rounded bg-black/30 px-1.5 py-0.5 text-slate-300">置信度 <b className="text-violet-300">{diagnosis.confidence}%</b></span>
          </div>
          {diagnosis.sustain_forecast && (
            <div className="text-slate-400">⏳ {diagnosis.sustain_forecast}</div>
          )}

          <div className={`text-[10px] ${diagnosis.exit_signal_triggered ? "text-rose-400" : "text-emerald-400"}`}>
            {diagnosis.exit_signal_triggered ? "⚠ 已触发离场信号" : "✓ 离场信号尚未触发"}
          </div>
        </div>
      )}

      {/* v9.95.1（第五段 P2）：主线诊断卡问 AI —— 携带主线现场数据（验收缺口：模块问 AI 入口少主线卡） */}
      <div className="flex justify-end border-t border-white/5 pt-1.5">
        <AskAI compact
          context={`主线：${mainline.mainline}（涨停${mainline.ztCount}家·最高${mainline.height}板·强度${mainline.strengthScore ?? "—"}分）
板块涨幅${mainline.boardPct}% · 资金${(mainline.mainNet / 1e8).toFixed(1)}亿
龙头：${mainline.leaders.map(l => `${l.role} ${l.name}(${l.code})`).join("、")}
风险提示：${mainline.caution ?? "—"}`}
          placeholder="问：这条主线还能上车吗？龙头怎么选？"
        />
      </div>

      {!loading && !diagnosis && !error && (
        <button onClick={load} className="rounded bg-violet-500/20 px-2 py-1 text-[10px] text-violet-200 hover:bg-violet-500/30">
          重新生成诊断
        </button>
      )}
    </div>
  );
}

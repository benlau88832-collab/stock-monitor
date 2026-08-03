// 主线诊断卡（v9.23-4，PRD 7.2 mainline_diagnosis schema）
// 真实 LLM 优先（mainlineDiagnosis 任务槽）→ 失败降级规则引擎（强度分+离场信号）
// 结构化输出：结论/理由/风险/置信度分行，禁止大段文字
import { useState, useEffect } from "react";
import { callAI } from "../lib/ai";
import { parseAIJSON } from "../lib/ai";
import { calcMainlineStrength } from "../lib/mainlineScore";
import { checkExitSignal } from "../lib/exitSignal";
import type { MainlineGroup } from "../lib/stockToMainline";
import DisclaimerTag from "./DisclaimerTag";

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
}

interface Props {
  mainline: MainlineGroup;
  onClose: () => void;
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
        const parsed = parseAIJSON<MainlineDiagnosis>(result.text, ["strength_score", "mainline"]);
        if (parsed && parsed.mainline && parsed.strength_score != null) {
          setDiagnosis(parsed);
          return;
        }
        console.warn("[MainlineDiagnosis] JSON 解析失败，降级规则引擎:", result.text.slice(0, 200));
      }
      // 降级：规则引擎（强度分 + 离场信号）
      const strength = calcMainlineStrength({
        ztCount: mainline.ztCount,
        totalZtCount: Math.max(mainline.ztCount * 3, 30), // 无全市场数据，用 3× 近似
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
          <div className="space-y-0.5">
            <div className="text-slate-500">核心：{diagnosis.leader.core.join("、") || "—"}</div>
            {diagnosis.leader.follower.length > 0 && <div className="text-slate-600">跟风：{diagnosis.leader.follower.join("、")}</div>}
            {diagnosis.leader.hype.length > 0 && <div className="text-slate-600">蹭热点：{diagnosis.leader.hype.join("、")}</div>}
          </div>
          {diagnosis.risk.length > 0 && (
            <div className="text-rose-300/90">⚠ 风险：{diagnosis.risk.join("；")}</div>
          )}
          <div className={`text-[10px] ${diagnosis.exit_signal_triggered ? "text-rose-400" : "text-emerald-400"}`}>
            {diagnosis.exit_signal_triggered ? "⚠ 已触发离场信号" : "✓ 离场信号尚未触发"}
          </div>
        </div>
      )}

      {!loading && !diagnosis && !error && (
        <button onClick={load} className="rounded bg-violet-500/20 px-2 py-1 text-[10px] text-violet-200 hover:bg-violet-500/30">
          重新生成诊断
        </button>
      )}
    </div>
  );
}

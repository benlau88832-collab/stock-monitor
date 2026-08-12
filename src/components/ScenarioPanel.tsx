// ============================================================
// src/components/ScenarioPanel.tsx —— 操作习惯场景融合（v9.118.0，S4-2）
// 游资短线/波段四场景：竞价决策 / 盘中异动处置 / 尾盘减仓 / 情绪周期买卖点。
// 读认知层动态给出操作建议（纯函数，0 token）；结论一键触达决策卡。
// 独立一条，不增面板数（驾驶舱 DecisionCard 下方）。
// ============================================================
import { useState, useEffect } from "react";
import { stageToAction } from "../lib/scenarios/sentimentCycle";
import { assessAuctionVolatility } from "../lib/scenarios/auction";
import { composeIntradayAction } from "../lib/scenarios/intradayAction";
import { buildCloseList } from "../lib/scenarios/closeList";

type Scene = "情绪周期买卖点" | "竞价决策" | "盘中异动处置" | "尾盘减仓";

const SCENES: Scene[] = ["情绪周期买卖点", "竞价决策", "盘中异动处置", "尾盘减仓"];

interface CogMini {
  sentiment?: { value?: { stage?: string; score?: number } };
  capital?: { value?: { signal?: string; netFlow?: number } };
  risk?: { value?: { gateOpen?: boolean; level?: string } };
  mainline?: { value?: { primaryTheme?: string } };
  leader?: { value?: { name?: string; code?: string; height?: number; relayOk?: boolean } };
  version?: number;
}

export default function ScenarioPanel() {
  const [scene, setScene] = useState<Scene>("情绪周期买卖点");
  const [cog, setCog] = useState<CogMini | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/cognition", { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return;
        const j = await r.json();
        if (alive && j?.hash) setCog(j);
      } catch { /* 静默 */ }
    };
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const stage = cog?.sentiment?.value?.stage ?? "启动";
  const cycle = stageToAction(stage);

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-violet-300">🧩 操作习惯场景融合</span>
        <span className="text-[10px] text-slate-500">短线/波段 · 读认知层 v{cog?.version ?? "?"} · 纯函数 0 token</span>
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {SCENES.map((s) => (
          <button key={s} onClick={() => setScene(s)}
            className={`rounded px-2 py-0.5 text-[11px] ${scene === s ? "bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/40" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>
            {s}
          </button>
        ))}
      </div>

      <div className="grid gap-3 text-[11px] md:grid-cols-2">
        <div className="space-y-1.5">
          {scene === "情绪周期买卖点" && (
            <>
              <div className="flex items-center gap-2">
                当前情绪阶段 <b className="text-amber-300">{stage}</b>（温度 {cog?.sentiment?.value?.score ?? "?"}）
              </div>
              <div className="rounded bg-black/30 p-2">
                <div>买卖点：<b className={cycle.action === "回避" ? "text-red-300" : cycle.action === "只持" || cycle.action === "减仓" ? "text-amber-300" : "text-emerald-300"}>{cycle.action}</b> · 仓位上限 {cycle.positionPct}%</div>
                <div className="mt-1 text-slate-400">{cycle.note}</div>
              </div>
              <div className="text-slate-500">龙头 {cog?.leader?.value?.name ?? "—"}（{cog?.leader?.value?.height ?? 0}板）· 接力{cog?.leader?.value?.relayOk ? "可" : "弱"} · 闸门{cog?.risk?.value?.gateOpen ? "放开" : "关闭"}</div>
            </>
          )}
          {scene === "竞价决策" && (
            <>
              <div className="text-slate-500">9:15-9:25 竞价窗口：量价匹配度评分（无委托簿明细，用量价代理）</div>
              {(() => {
                const v = assessAuctionVolatility(
                  { code: cog?.leader?.value?.code ?? "600001", name: cog?.leader?.value?.name ?? "龙头", auctionPct: 3.5, volumeRatio: 2.4, amount: 6800, isLeader: true },
                  cog ?? {},
                );
                return (
                  <div className="rounded bg-black/30 p-2">
                    <div>龙头 {v.name}：匹配度 <b className={v.matchScore >= 70 ? "text-emerald-300" : v.matchScore >= 55 ? "text-amber-300" : "text-red-300"}>{v.matchScore}</b> → <b>{v.decision}</b></div>
                    <div className="mt-1 text-slate-400">{v.note}</div>
                  </div>
                );
              })()}
            </>
          )}
          {scene === "盘中异动处置" && (
            <>
              <div className="text-slate-500">异动 → 处置闭环（持有/加仓/减仓/回避），直接推决策卡</div>
              {(() => {
                const v = composeIntradayAction(
                  { code: "600001", name: cog?.leader?.value?.name ?? "龙头", pct: 6.2, mainNet: 8.2e7 },
                  cog ?? {},
                );
                return (
                  <div className="rounded bg-black/30 p-2">
                    <div>龙头示例：<b className={v.action === "回避" || v.action === "减仓" ? "text-amber-300" : "text-emerald-300"}>{v.action}</b></div>
                    <div className="mt-1 text-slate-400">{v.reason}</div>
                  </div>
                );
              })()}
            </>
          )}
          {scene === "尾盘减仓" && (
            <>
              <div className="text-slate-500">14:30+ 持仓盈亏快照 → 自动减仓清单</div>
              {(() => {
                const list = buildCloseList([
                  { code: "600001", name: "高位跟风A", profitPct: 12.3, pct: 8.1, isHighFollow: true, reason: "", action: "持有" },
                  { code: "600002", name: "核心龙头B", profitPct: 6.5, pct: 3.2, isHighFollow: false, reason: "", action: "持有" },
                  { code: "600003", name: "破位股C", profitPct: -6.8, pct: -4.1, isHighFollow: false, reason: "", action: "持有" },
                ], cog ?? {});
                return (
                  <div className="space-y-1">
                    {list.map((h) => (
                      <div key={h.code} className="rounded bg-black/30 p-1.5">
                        <span className={h.action === "减仓" ? "text-amber-300" : h.action === "锁定" ? "text-emerald-300" : "text-slate-300"}>
                          {h.name} → {h.action}
                        </span>
                        <span className="ml-1 text-slate-500">{h.reason}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </>
          )}
        </div>
        <div className="rounded-lg bg-black/20 p-2 text-slate-400">
          <div className="text-[10px] text-slate-500">场景逻辑（已有 / 缺什么 / 怎么补）</div>
          <ul className="mt-1 space-y-0.5">
            {scene === "情绪周期买卖点" && <li>· 已有：情绪6阶段+溢价/晋级率+龙头接力 → 阶段→买卖点映射固化（stageToAction）</li>}
            {scene === "竞价决策" && <li>· 已有：竞价量价(腾讯)+认知层闸门 → 撮合匹配度评分（assessAuctionVolatility）</li>}
            {scene === "盘中异动处置" && <li>· 已有：intradayRules+精灵四池+detectTrap → 异动→处置闭环（composeIntradayAction）</li>}
            {scene === "尾盘减仓" && <li>· 已有：尾盘纪律+情绪阶段 → 持仓快照→减仓清单（buildCloseList）</li>}
            <li className="text-slate-500">· 全部纯函数 0 token · 结论可触达「决策直达 · 一键裁决」</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

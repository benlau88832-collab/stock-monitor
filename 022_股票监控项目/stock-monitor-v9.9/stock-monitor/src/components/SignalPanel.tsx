import { useState } from "react";
import { getSignalStats, getLedger, loadDiaries, saveDiary, exportAllData, importAllData, runSignalBackfill, markBackfilledToday } from "../lib/signalLedger";
import { localDateStr } from "../lib/format";

// 信号命中率卡片 + 复盘日记 + 数据导出
// 嵌入 DailySummary 区域下方

function todayStr(): string { return localDateStr(); }

export default function SignalPanel() {
  const [showLedger, setShowLedger] = useState(false);
  const [showDiary, setShowDiary] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState("");

  // 日记状态
  const today = todayStr();
  const diaries = loadDiaries();
  const todayDiary = diaries.find(d => d.date === today);
  const [actions, setActions] = useState(todayDiary?.actions ?? "");
  const [followed, setFollowed] = useState(todayDiary?.followedSignal ?? "");
  const [score, setScore] = useState(todayDiary?.selfScore ?? 3);

  const stats = getSignalStats();
  const ledger = getLedger();
  const totalSignals = ledger.length;
  const backfilled = ledger.filter(e => e.backfilled).length;

  // P1：手动补全回填（三保险之一，配合 App 首载 + 定时）
  const handleBackfill = async () => {
    if (backfilling) return;
    setBackfilling(true);
    try {
      const n = await runSignalBackfill();
      markBackfilledToday();
      setBackfillMsg(n > 0 ? `✅ 回填 ${n} 条信号收益率` : "无需回填（无到期未回填信号）");
    } catch {
      setBackfillMsg("❌ 回填失败（网络/接口异常）");
    } finally {
      setBackfilling(false);
      // 触发本组件重渲染以刷新统计
      setShowLedger(prev => prev);
    }
  };

  const handleSaveDiary = () => {
    saveDiary({ date: today, actions, followedSignal: followed, selfScore: score });
  };

  const handleExport = () => {
    const json = exportAllData();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `stock-monitor-backup-${today}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!confirm("导入将覆盖现有数据，确认继续？")) return;
      const text = await file.text();
      if (importAllData(text)) { alert("导入成功，页面将刷新"); location.reload(); }
      else alert("导入失败：JSON格式错误");
    };
    input.click();
  };

  return (
    <div className="space-y-3">
      {/* 信号命中率卡片 */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-slate-200">📊 信号命中率</div>
          <div className="flex gap-2">
            {/* P1：手动补全回填按钮 */}
            <button onClick={handleBackfill} disabled={backfilling}
              className="text-[11px] text-sky-300 hover:text-sky-200 disabled:opacity-40">
              {backfilling ? "回填中…" : "🔄 补全回填"}
            </button>
            <button onClick={() => setShowLedger(v => !v)}
              className="text-[11px] text-amber-300 hover:text-amber-200">
              {showLedger ? "收起" : `台账(${totalSignals}条)`}
            </button>
          </div>
        </div>

        {backfillMsg && <div className="text-[11px] text-slate-400">{backfillMsg}</div>}

        {stats.length === 0 ? (
          <div className="text-xs text-slate-500">
            {totalSignals > 0 ? `已记录${totalSignals}条信号，${backfilled}条已回填，样本积累中…` : "暂无信号记录（系统将自动记录否决/周期切换等信号）"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-white/10 text-slate-400">
                <th className="px-2 py-1 text-left">信号类型</th>
                <th className="px-2 py-1 text-right">样本数</th>
                <th className="px-2 py-1 text-right">T+5均收益</th>
                <th className="px-2 py-1 text-right">T+5胜率</th>
                <th className="px-2 py-1 text-right">健康度</th>
              </tr></thead>
              <tbody>
                {stats.map(s => (
                  <tr key={s.typeLabel} className="border-b border-white/5">
                    <td className="px-2 py-1 text-slate-300">{s.typeLabel}</td>
                    <td className="px-2 py-1 text-right text-slate-400">{s.count}{s.count < 10 ? " ⚠️" : ""}</td>
                    <td className={`px-2 py-1 text-right font-semibold ${(s.avgReturnT5 ?? 0) > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                      {s.avgReturnT5 != null ? `${s.avgReturnT5 > 0 ? "+" : ""}${s.avgReturnT5}%` : "—"}
                    </td>
                    <td className="px-2 py-1 text-right text-slate-300">{s.winRateT5 != null ? `${s.winRateT5}%` : "—"}</td>
                    <td className="px-2 py-1 text-right">
                      {s.health === "healthy" && <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-emerald-500/20 text-emerald-300">有效</span>}
                      {s.health === "warning" && <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-amber-500/20 text-amber-300">一般</span>}
                      {s.health === "suspect" && <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-rose-500/20 text-rose-300" title="胜率<45%，信号可信度存疑，建议降低权重">存疑</span>}
                      {s.health === "insufficient" && <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-slate-500/20 text-slate-400">样本不足</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stats.some(s => s.count < 10) && (
              <div className="text-[11px] text-slate-600 mt-1">⚠️ 样本不足10条的统计仅供参考，不具统计显著性</div>
            )}
          </div>
        )}

        {/* 台账展开 */}
        {showLedger && ledger.length > 0 && (
          <div className="max-h-40 overflow-y-auto border-t border-white/10 pt-2">
            {ledger.slice(0, 20).map(e => (
              <div key={e.id} className="flex items-center justify-between text-[11px] py-0.5 border-b border-white/5">
                <span className="text-slate-500">{e.date}</span>
                <span className="text-slate-300">{e.typeLabel}</span>
                <span className="text-slate-400">{e.code === "MARKET" ? "全市场" : `${e.name}(${e.code})`}</span>
                <span className={e.returnT5 != null ? (e.returnT5 > 0 ? "text-rose-400" : "text-emerald-400") : "text-slate-600"}>
                  {e.returnT5 != null ? `T+5: ${e.returnT5 > 0 ? "+" : ""}${e.returnT5}%` : "待回填"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 复盘日记 */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-slate-200">📝 复盘日记（{today}）</div>
          <button onClick={() => setShowDiary(v => !v)} className="text-[11px] text-amber-300 hover:text-amber-200">
            {showDiary ? "收起" : "展开"}
          </button>
        </div>

        {showDiary && (
          <div className="space-y-2">
            <div>
              <label className="text-[11px] text-slate-500">今日操作</label>
              <input value={actions} onChange={e => setActions(e.target.value)} placeholder="如：加仓了XX，止损了YY"
                className="w-full rounded bg-black/30 border border-white/10 px-2 py-1 text-xs text-slate-200 placeholder-slate-600 outline-none" />
            </div>
            <div>
              <label className="text-[11px] text-slate-500">是否执行了系统信号</label>
              <input value={followed} onChange={e => setFollowed(e.target.value)} placeholder="如：执行了否决信号，回避了ST股"
                className="w-full rounded bg-black/30 border border-white/10 px-2 py-1 text-xs text-slate-200 placeholder-slate-600 outline-none" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-slate-500">自评</label>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setScore(n)}
                  className={`w-6 h-6 rounded text-xs font-bold ${score === n ? "bg-amber-500/30 text-amber-300" : "bg-white/10 text-slate-400"}`}>
                  {n}
                </button>
              ))}
            </div>
            <button onClick={handleSaveDiary}
              className="rounded px-3 py-1 text-xs bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30">保存日记</button>

            {/* 历史日记（周视图） */}
            {diaries.length > 1 && (
              <div className="border-t border-white/10 pt-2 max-h-32 overflow-y-auto">
                <div className="text-[11px] text-slate-500 mb-1">近期日记</div>
                {diaries.slice(0, 7).map(d => (
                  <div key={d.date} className="text-[11px] py-0.5 border-b border-white/5">
                    <span className="text-slate-500">{d.date}</span>
                    <span className="ml-2 text-slate-300">{d.actions || "无记录"}</span>
                    <span className="ml-2 text-amber-400">{"★".repeat(d.selfScore)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 数据导出/导入 */}
      <div className="flex gap-2">
        <button onClick={handleExport}
          className="rounded px-3 py-1 text-[11px] bg-white/10 text-slate-300 hover:bg-white/20">💾 导出数据备份</button>
        <button onClick={handleImport}
          className="rounded px-3 py-1 text-[11px] bg-white/10 text-slate-300 hover:bg-white/20">📂 导入数据恢复</button>
      </div>
    </div>
  );
}

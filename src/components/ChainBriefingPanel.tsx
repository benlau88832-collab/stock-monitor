// ============================================================
// ChainBriefingPanel.tsx —— 产业链简报板块（任务 09，v9.148.0）
// 数据源：GET /api/chain/briefings（6 链最新简报，含阶段/受益标的/关键信号/风险/人物）
// 位置：驾驶舱顶部（第一眼入口）+ #briefing 独立视图（手机扫码直连）
// ============================================================
import { useEffect, useState, useCallback } from "react";

interface BriefingItem {
  chain: string;
  date: string;
  content: {
    stage: string;
    summary: string;
    beneficiaries?: Array<{ name: string; reason: string; evidence?: string }>;
    logicChange?: string;
    keySignals?: Array<{ text: string; verified?: boolean }>;
    risks?: string[];
    fallback?: boolean;
  };
}

const CHAIN_NAMES: Record<string, string> = {
  semiconductor: "半导体",
  aiCompute: "AI算力",
  aiPower: "AI电力设备",
  nonferrous: "有色金属",
  minorMetals: "小金属",
  robotics: "机器人",
};

const STAGE_COLOR: Record<string, string> = {
  启动: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  加速: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  分歧: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  退潮: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  冰点: "bg-slate-500/20 text-slate-300 border-slate-500/40",
};

export default function ChainBriefingPanel({ compact = false }: { compact?: boolean }) {
  const [items, setItems] = useState<BriefingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/chain/briefings");
      const j = await r.json();
      if (Array.isArray(j.items)) setItems(j.items);
    } catch (e) {
      setError("简报加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const img = new Image();
    img.onload = () => setQr("/api/chain/briefings/qr?" + Date.now());
    img.onerror = () => setQr(null);
    img.src = "/api/chain/briefings/qr";
  }, [load]);

  if (loading) {
    return (
      <section className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="text-sm font-black text-slate-300">🔗 产业链简报</div>
        <div className="mt-2 text-xs text-slate-500">加载中…</div>
      </section>
    );
  }

  const gridClass = compact ? "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" : "grid grid-cols-1 gap-3 md:grid-cols-2";

  return (
    <section className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-black text-emerald-200">🔗 产业链简报</span>
        <span className="text-[10px] text-slate-500">每晚 21:00 自动挖掘 · 外网交叉验证 · LLM 研判</span>
        <span className="ml-auto flex items-center gap-2">
          {qr && (
            <span className="flex items-center gap-1.5" title="手机扫码直达简报">
              <img src={qr} alt="扫码看简报" className="h-10 w-10 rounded bg-white p-0.5" />
              <span className="text-[10px] leading-tight text-slate-400">手机扫码<br />看简报</span>
            </span>
          )}
          <button onClick={load} className="rounded bg-emerald-500/15 px-2 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/25">
            🔄 刷新
          </button>
        </span>
      </div>

      {error && <div className="mb-2 text-[11px] text-rose-400">{error}</div>}

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 p-4 text-center text-xs text-slate-500">
          简报尚未生成 —— 每晚 21:00 自动运行；也可等待今晚任务或稍后刷新。
        </div>
      ) : (
        <div className={gridClass}>
          {items.map((b) => {
            const stage = b.content?.stage ?? "";
            const signals = b.content?.keySignals ?? [];
            const risks = b.content?.risks ?? [];
            const benef = b.content?.beneficiaries ?? [];
            return (
              <div key={b.chain} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black text-slate-100">{CHAIN_NAMES[b.chain] ?? b.chain}</span>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${STAGE_COLOR[stage] ?? "bg-white/10 text-slate-300"}`}>{stage || "未生成"}</span>
                  {b.content?.fallback && <span className="rounded bg-amber-500/15 px-1 text-[9px] text-amber-300">规则兜底</span>}
                  <span className="ml-auto text-[10px] text-slate-500">{b.date}</span>
                </div>
                {b.content?.summary && <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">{b.content.summary}</p>}
                {benef.length > 0 && (
                  <div className="mt-1.5">
                    <span className="text-[10px] font-bold text-emerald-400">受益：</span>
                    <span className="text-[11px] text-slate-300">
                      {benef.slice(0, 3).map((x) => x.name).join("、")}
                    </span>
                  </div>
                )}
                {signals.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {signals.slice(0, 3).map((s, i) => (
                      <div key={i} className="flex items-start gap-1 text-[10px] text-slate-400">
                        <span className={s.verified ? "text-emerald-400" : "text-amber-400"}>{s.verified ? "✓" : "⚠"}</span>
                        <span>{s.text.slice(0, 80)}{s.text.length > 80 ? "…" : ""}</span>
                      </div>
                    ))}
                  </div>
                )}
                {risks.length > 0 && (
                  <div className="mt-1.5 text-[10px] text-rose-400/90">
                    <span className="font-bold">风险：</span>
                    {risks.slice(0, 2).join("；")}
                  </div>
                )}
                {b.content?.logicChange && (
                  <div className="mt-1.5 text-[10px] text-violet-300/80">🔄 {b.content.logicChange.slice(0, 70)}</div>
                )}
                {/* v9.148.0（任务12）：闭环引导 —— 看好的标的去个股雷达拍板留痕（T+5 回填让 AI 越用越准） */}
                <div className="mt-2 border-t border-white/5 pt-1.5">
                  <button
                    onClick={() => { window.location.hash = "radar"; }}
                    className="rounded bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-300 hover:bg-sky-500/25"
                  >
                    📋 去个股雷达分析 / 拍板 →
                  </button>
                  <span className="ml-1.5 text-[9px] text-slate-600">拍板留痕 → T+5 真实盈亏 → AI 越用越准</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

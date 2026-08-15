// ============================================================
// ChainBriefingPanel.tsx —— 产业链简报板块（任务 09，v9.148.0）
// 数据源：GET /api/chain/briefings（6 链最新简报，含阶段/受益标的/关键信号/风险/人物）
// 位置：驾驶舱顶部（第一眼入口）+ #briefing 独立视图（手机扫码直连）
// ============================================================
import { useEffect, useState, useCallback } from "react";
import { getLocalToken } from "../lib/cloudStore"; // v9.148.1（T7）：采纳建议需带 token

interface PersonSuggestion {
  name: string;
  zh?: string;
  why?: string;
  suggestedAt?: string;
}

interface BriefingItem {
  chain: string;
  date: string;
  content: {
    stage: string;
    summary: string;
    beneficiaries?: Array<{ name: string; code?: string; reason: string; evidence?: string }>;
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
  // v9.148.1（T7）：人物自扩散建议池
  const [suggestions, setSuggestions] = useState<PersonSuggestion[]>([]);
  // v9.148.1（T8）：推送绑定状态（未绑定显示黄条引导）
  const [pushConfigured, setPushConfigured] = useState<boolean | null>(null);
  // v9.148.2（A1）：采纳失败提示（手机端写操作降级）
  const [personError, setPersonError] = useState<string | null>(null);

  const loadPushState = useCallback(async () => {
    try {
      const r = await fetch("/api/chain/push-state");
      const j = await r.json();
      setPushConfigured(j.configured === true);
    } catch { setPushConfigured(null); }
  }, []);

  const loadSuggestions = useCallback(async () => {
    try {
      const r = await fetch("/api/chain/people/suggestions");
      const j = await r.json();
      if (Array.isArray(j.items)) setSuggestions(j.items);
    } catch { /* 建议加载失败不阻塞 */ }
  }, []);

  const confirmPerson = async (name: string) => {
    try {
      const token = await getLocalToken();
      const r = await fetch("/api/chain/people/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "x-local-token": token } : {}) },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      loadSuggestions();
    } catch {
      // v9.148.2（A1）：非本机访问 token 端点 403 → 写操作降级提示（手机端只读）
      setPersonError("采纳失败：人物管理需在电脑本机操作（手机端只读）");
      setTimeout(() => setPersonError(null), 4000);
    }
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/chain/briefings");
      const j = await r.json();
      if (Array.isArray(j.items)) setItems(j.items);
      // v9.148.2（A7 观察4）：简报刷新时同刷推送状态（设置页保存后点刷新即消失黄条）
      loadPushState();
    } catch (e) {
      setError("简报加载失败");
    } finally {
      setLoading(false);
    }
  }, [loadPushState]);

  useEffect(() => {
    load();
    loadSuggestions();
    loadPushState();
    const img = new Image();
    img.onload = () => setQr("/api/chain/briefings/qr?" + Date.now());
    img.onerror = () => setQr(null);
    img.src = "/api/chain/briefings/qr";
  }, [load, loadSuggestions, loadPushState]);

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

      {/* v9.148.1（T8）：微信推送未绑定 → 黄条引导（用户零感知问题的修复） */}
      {pushConfigured === false && (
        <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
          📱 微信推送未绑定 —— ⚙️ 设置页配置 Server酱 SendKey 后，每天 8:35 自动收到简报摘要（当前仅网页可见）
        </div>
      )}

      {/* v9.148.1（T7）：人物自扩散建议（LLM 每晚从情报中发现的新关键人物） */}
      {personError && <div className="mb-2 text-[11px] text-rose-400">{personError}</div>}
      {suggestions.length > 0 && (
        <details className="mb-2 rounded-lg border border-violet-500/20 bg-violet-950/10 px-2 py-1.5">
          <summary className="cursor-pointer text-[11px] font-bold text-violet-300">
            🧑‍🚀 新增人物建议（{suggestions.length}）
          </summary>
          <div className="mt-1.5 space-y-1">
            {suggestions.map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-[11px] text-slate-300">
                <span className="font-bold">{s.name}</span>
                {s.zh && <span className="text-slate-500">{s.zh}</span>}
                <span className="flex-1 truncate text-[10px] text-slate-500">{s.why}</span>
                <button
                  onClick={() => confirmPerson(s.name)}
                  className="shrink-0 rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold text-violet-300 hover:bg-violet-500/30"
                >
                  ✔ 采纳（加入每日追踪）
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

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
                      {benef.slice(0, 3).map((x) => (
                        // v9.148.1（T9）：受益标的带 code，点击跳个股雷达分析
                        <button
                          key={x.code ?? x.name}
                          onClick={() => {
                            // v9.149.0（B6 P2-11）：跳转前定位个股（雷达页选中该股）
                            if (x.code) import("../lib/uiContext").then(m => m.setCurrentStock(x.code!, x.name)).catch(() => {});
                            window.location.hash = "radar";
                          }}
                          className="mr-1 rounded bg-emerald-500/10 px-1 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/20"
                          title="去个股雷达分析"
                        >
                          {x.name}{x.code ? `(${x.code})` : ""}
                        </button>
                      ))}
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

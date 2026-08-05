import { useState, useEffect, useCallback, useRef } from "react";
// v9.31：双榜数据源（东方财富 + 同花顺）交叉比对
// - 东财：emappdata.eastmoney.com（实测支持 CORS，浏览器直连）
// - 同花顺：dq.10jqka.com.cn 热度接口（实测支持 CORS，浏览器直连）
// - 双榜共振（同一只股票两边都上榜）→ 顶部醒目提醒 + 行高亮
import { fetchPopularityRank, fetchTHSPopularityRank, fetchStockBriefBatch, type PopularityItem, type THSPopularityItem, type StockBrief } from "../lib/api";
import { fmtMoney, fmtPct, pctColor } from "../lib/format";
import { stockRealUrl } from "../lib/realLinks";

// ============== 昨日快照缓存 ==============
function todayKey(): string {
  const d = new Date();
  return `popularity:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `popularity:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface SnapshotRow { code: string; name: string; rank: number }

function saveSnapshot(items: SnapshotRow[]): void {
  try {
    localStorage.setItem(todayKey(), JSON.stringify(items));
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("popularity:")) keys.push(k);
    }
    keys.sort().reverse();
    for (let i = 5; i < keys.length; i++) localStorage.removeItem(keys[i]);
  } catch { /* 满了静默 */ }
}

function loadYesterdaySnapshot(): SnapshotRow[] | null {
  try {
    const raw = localStorage.getItem(yesterdayKey());
    return raw ? (JSON.parse(raw) as SnapshotRow[]) : null;
  } catch { return null; }
}

// 拥挤度阈值：50只中同一代码段≥8只 → 派发窗口预警
const CROWDING_THRESHOLD = 8;

// ============== 合并行 ==============
interface MergeRow {
  code: string;
  name: string;
  emRank: number | null;   // 东财排名
  thsRank: number | null;  // 同花顺排名
  riseAndFall: number | null;
  thsConcepts: string[];
  thsTag: string;
  resonance: boolean;      // 双榜共振
}

export default function PopularityRadar() {
  const [rows, setRows] = useState<MergeRow[]>([]);
  const [briefs, setBriefs] = useState<Map<string, StockBrief>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emOk, setEmOk] = useState(false);
  const [thsOk, setThsOk] = useState(false);
  const [yesterdayRows, setYesterdayRows] = useState<SnapshotRow[] | null>(null);
  const fetchedRef = useRef(false);

  const load = useCallback(async () => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    try {
      // 双数据源并行拉取（一个失败不影响另一个）
      const [emRes, thsRes] = await Promise.allSettled([
        fetchPopularityRank(50),
        fetchTHSPopularityRank(30),
      ]);
      const emItems: PopularityItem[] = emRes.status === "fulfilled" ? emRes.value : [];
      const thsItems: THSPopularityItem[] = thsRes.status === "fulfilled" ? thsRes.value : [];
      setEmOk(emRes.status === "fulfilled");
      setThsOk(thsRes.status === "fulfilled");

      if (emItems.length === 0 && thsItems.length === 0) {
        setError("两个平台人气榜均不可用");
        return;
      }

      // 合并
      const emMap = new Map(emItems.map(i => [i.code, i]));
      const merged: MergeRow[] = [];
      const seen = new Set<string>();
      for (const t of thsItems) {
        if (seen.has(t.code)) continue;
        seen.add(t.code);
        const em = emMap.get(t.code);
        merged.push({
          code: t.code, name: t.name,
          emRank: em?.rank ?? null,
          thsRank: t.rank,
          riseAndFall: t.riseAndFall,
          thsConcepts: t.concepts, thsTag: t.tag,
          resonance: !!em,
        });
        emMap.delete(t.code); // 已消费
      }
      // 东财独有
      for (const e of emItems) {
        if (seen.has(e.code)) continue;
        seen.add(e.code);
        merged.push({
          code: e.code, name: e.name || e.code,
          emRank: e.rank, thsRank: null,
          riseAndFall: null, thsConcepts: [], thsTag: "",
          resonance: false,
        });
      }
      // 排序：双榜共振置顶 → 东财 rank → 同花顺 rank
      merged.sort((a, b) => {
        if (a.resonance !== b.resonance) return a.resonance ? -1 : 1;
        const ar = a.emRank ?? a.thsRank ?? 999;
        const br = b.emRank ?? b.thsRank ?? 999;
        return ar - br;
      });
      setRows(merged);
      saveSnapshot(merged.map(r => ({ code: r.code, name: r.name, rank: r.emRank ?? r.thsRank ?? 0 })));
      setError(null);

      // 批量补行情（名称/价格/涨幅/成交额）
      const codes = merged.map(r => r.code).filter(c => /^\d{6}$/.test(c));
      if (codes.length > 0) {
        const map = await fetchStockBriefBatch(codes);
        setBriefs(map);
      }
    } catch {
      setError("人气榜加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setYesterdayRows(loadYesterdaySnapshot());
    load();
  }, [load]);

  if (error) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold text-amber-200">🔥 人气榜拥挤度</span>
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] text-amber-300">暂不可用</span>
        </div>
        <div className="text-[11px] text-slate-500">{error}</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="text-xs text-slate-400 animate-pulse">加载东财 + 同花顺人气榜…</div>
      </div>
    );
  }

  // 新入榜检测（基于昨日快照）
  const yesterdayCodes = yesterdayRows ? new Set(yesterdayRows.map(i => i.code)) : null;

  // 双榜共振列表
  const resonanceRows = rows.filter(r => r.resonance);

  // 代码前缀集中度（全部上榜股票）
  const prefixMap = new Map<string, string[]>();
  for (const r of rows) {
    const prefix = r.code.slice(0, 3);
    const arr = prefixMap.get(prefix) ?? [];
    arr.push(r.code);
    prefixMap.set(prefix, arr);
  }
  const crowdedPrefixes = [...prefixMap.entries()].filter(([, codes]) => codes.length >= CROWDING_THRESHOLD);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
      {/* 标题 */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-amber-200">🔥 人气榜拥挤度（东财 × 同花顺双榜）</span>
          <span className="text-[11px] text-slate-500">
            {emOk ? "东财✓" : "东财✗"} · {thsOk ? "同花顺✓" : "同花顺✗"} · {rows.length}只
          </span>
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5">
          双榜共振 = 两个平台散户关注度都高，信号更可靠（关注度共振，反向参考）。
        </div>
      </div>

      {/* v9.31：双榜共振提醒 */}
      {resonanceRows.length > 0 && (
        <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-2 py-1.5">
          <div className="text-[11px] font-bold text-violet-300">
            ⚡ 双榜共振 {resonanceRows.length} 只：东财 + 同花顺同时上榜
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {resonanceRows.slice(0, 12).map(r => (
              <a key={r.code} href={stockRealUrl(r.code)} target="_blank" rel="noopener noreferrer"
                className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-200 hover:bg-violet-500/30">
                {r.name}({r.code}) 东财#{r.emRank}/同花顺#{r.thsRank}
              </a>
            ))}
            {resonanceRows.length > 12 && <span className="text-[10px] text-violet-400 self-center">+{resonanceRows.length - 12}</span>}
          </div>
        </div>
      )}

      {/* 拥挤度警告 */}
      {crowdedPrefixes.length > 0 && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1">
          <span className="text-[11px] font-bold text-rose-400">
            ⚠️ 拥挤度极高：同段 ≥{CROWDING_THRESHOLD} 只上榜，历史经验对应派发窗口
          </span>
        </div>
      )}

      {/* 昨日对比 */}
      {!yesterdayCodes && (
        <div className="text-[11px] text-slate-500 bg-slate-500/10 rounded px-2 py-0.5">
          💡 首日运行，无昨日对比数据
        </div>
      )}

      {/* 列表 */}
      <div className="max-h-[420px] overflow-y-auto [scrollbar-width:thin]">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-slate-500 border-b border-white/10 sticky top-0 bg-[#0a0f1a]">
              <th className="text-left px-1 py-1">名称</th>
              <th className="text-center px-1 py-1 w-16">东财#</th>
              <th className="text-center px-1 py-1 w-16">同花顺#</th>
              <th className="text-right px-1 py-1">现价</th>
              <th className="text-right px-1 py-1">涨跌</th>
              <th className="text-right px-1 py-1">成交额</th>
              <th className="text-center px-1 py-1 w-20">标记</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const brief = briefs.get(row.code);
              const isNew = yesterdayCodes && !yesterdayCodes.has(row.code);
              const displayName = brief?.name || row.name || row.code;
              const pctVal = brief?.pct ?? row.riseAndFall;
              return (
                <tr key={row.code}
                  className={`border-b border-white/5 hover:bg-white/5 transition ${
                    row.resonance ? "bg-violet-500/10 border-violet-500/30" : isNew ? "bg-emerald-500/5" : ""
                  }`}>
                  <td className="px-1 py-1">
                    <a href={stockRealUrl(row.code)} target="_blank" rel="noopener noreferrer"
                      className="text-slate-200 hover:text-amber-300 font-medium">
                      {displayName}
                    </a>
                    <span className="text-slate-600 ml-1">{row.code}</span>
                    {row.thsConcepts.length > 0 && (
                      <span className="ml-1 text-[9px] text-sky-400/80">{row.thsConcepts.slice(0, 2).join("/")}</span>
                    )}
                    {row.thsTag && <span className="ml-1 text-[9px] text-amber-400/90">[{row.thsTag}]</span>}
                  </td>
                  <td className="px-1 py-1 text-center text-slate-300">{row.emRank ?? "—"}</td>
                  <td className="px-1 py-1 text-center text-slate-300">{row.thsRank ?? "—"}</td>
                  <td className="px-1 py-1 text-right text-slate-300">
                    {brief ? brief.price.toFixed(2) : "—"}
                  </td>
                  <td className={`px-1 py-1 text-right font-semibold ${pctVal != null ? pctColor(pctVal) : "text-slate-500"}`}>
                    {pctVal != null ? fmtPct(pctVal) : "—"}
                  </td>
                  <td className="px-1 py-1 text-right text-slate-400">
                    {brief ? fmtMoney(brief.amount) : "—"}
                  </td>
                  <td className="px-1 py-1 text-center space-x-0.5">
                    {row.resonance && (
                      <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-violet-500/25 text-violet-300">⚡共振</span>
                    )}
                    {isNew && (
                      <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-emerald-500/20 text-emerald-300">新</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

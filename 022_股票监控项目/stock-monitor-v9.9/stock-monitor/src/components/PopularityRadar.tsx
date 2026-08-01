import { useState, useEffect, useCallback, useRef } from "react";
import { fetchPopularityRank, fetchStockBriefBatch, type PopularityItem, type StockBrief } from "../lib/api";
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

function saveSnapshot(items: PopularityItem[]): void {
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

function loadYesterdaySnapshot(): PopularityItem[] | null {
  try {
    const raw = localStorage.getItem(yesterdayKey());
    return raw ? (JSON.parse(raw) as PopularityItem[]) : null;
  } catch { return null; }
}

// 拥挤度阈值：50只中同一代码段≥8只 → 派发窗口预警
const CROWDING_THRESHOLD = 8;

export default function PopularityRadar() {
  const [items, setItems] = useState<PopularityItem[]>([]);
  const [briefs, setBriefs] = useState<Map<string, StockBrief>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [yesterdayItems, setYesterdayItems] = useState<PopularityItem[] | null>(null);
  const fetchedRef = useRef(false);

  const load = useCallback(async () => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    try {
      const list = await fetchPopularityRank(50);
      if (list.length > 0) {
        setItems(list);
        saveSnapshot(list);
        setError(null);
        // 批量查询行情（名称/价格/涨幅/成交额）
        const codes = list.map(i => i.code).filter(c => /^\d{6}$/.test(c));
        if (codes.length > 0) {
          const map = await fetchStockBriefBatch(codes);
          setBriefs(map);
        }
      } else {
        setError("待接入");
      }
    } catch {
      setError("待接入");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setYesterdayItems(loadYesterdaySnapshot());
    load();
  }, [load]);

  // "待接入" 状态
  if (error) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold text-amber-200">🔥 人气榜拥挤度</span>
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] text-amber-300">{error}</span>
        </div>
        <div className="text-[11px] text-slate-500">
          东方财富人气榜接口探测失败（POST 接口可能受 CORS 限制），后续可通过代理接入。
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="text-xs text-slate-400 animate-pulse">探测人气榜接口…</div>
      </div>
    );
  }

  // 新入榜检测
  const yesterdayCodes = yesterdayItems ? new Set(yesterdayItems.map(i => i.code)) : null;

  // 代码前缀集中度
  const prefixMap = new Map<string, string[]>();
  for (const item of items) {
    const prefix = item.code.slice(0, 3);
    const arr = prefixMap.get(prefix) ?? [];
    arr.push(item.code);
    prefixMap.set(prefix, arr);
  }
  const crowdedPrefixes = [...prefixMap.entries()].filter(([, codes]) => codes.length >= CROWDING_THRESHOLD);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
      {/* 标题 */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-amber-200">🔥 人气榜拥挤度（反向指标）</span>
          <span className="text-[11px] text-slate-500">Top{items.length}</span>
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5">
          本榜为散户关注度，用作反向参考。集中度过高往往对应派发窗口。
        </div>
      </div>

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

      {/* 列表：表格式长方形行 */}
      <div className="max-h-[420px] overflow-y-auto [scrollbar-width:thin]">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-slate-500 border-b border-white/10 sticky top-0 bg-[#0a0f1a]">
              <th className="text-left px-1 py-1 w-6">#</th>
              <th className="text-left px-1 py-1">名称</th>
              <th className="text-right px-1 py-1">现价</th>
              <th className="text-right px-1 py-1">涨跌</th>
              <th className="text-right px-1 py-1">成交额</th>
              <th className="text-right px-1 py-1">换手</th>
              <th className="text-center px-1 py-1 w-10">标记</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const brief = briefs.get(item.code);
              const isNew = yesterdayCodes && !yesterdayCodes.has(item.code);
              const displayName = brief?.name || item.name || item.code;
              return (
                <tr key={item.code}
                  className={`border-b border-white/5 hover:bg-white/5 transition ${isNew ? "bg-emerald-500/5" : ""}`}>
                  <td className="px-1 py-1 text-slate-500">{item.rank}</td>
                  <td className="px-1 py-1">
                    <a href={stockRealUrl(item.code)} target="_blank" rel="noopener noreferrer"
                      className="text-slate-200 hover:text-amber-300 font-medium">
                      {displayName}
                    </a>
                    <span className="text-slate-600 ml-1">{item.code}</span>
                  </td>
                  <td className="px-1 py-1 text-right text-slate-300">
                    {brief ? brief.price.toFixed(2) : "—"}
                  </td>
                  <td className={`px-1 py-1 text-right font-semibold ${brief ? pctColor(brief.pct) : "text-slate-500"}`}>
                    {brief ? fmtPct(brief.pct) : "—"}
                  </td>
                  <td className="px-1 py-1 text-right text-slate-400">
                    {brief ? fmtMoney(brief.amount) : "—"}
                  </td>
                  <td className="px-1 py-1 text-right text-slate-400">
                    {brief ? `${brief.turnoverRate.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-1 py-1 text-center">
                    {isNew && (
                      <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-emerald-500/20 text-emerald-300">
                        新入榜
                      </span>
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

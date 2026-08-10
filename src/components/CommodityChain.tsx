import { useState, useEffect, useCallback, useRef } from "react";
import { fmtPct, pctColor } from "../lib/format";
import { COMMODITY_LIST, SMALL_METALS } from "../lib/commodities";
// v9.95.4（第五段 P1）：小金属监测 —— 无期货合约，走本地 PG 快讯关键词（newsByKeyword）
import { getLocalToken } from "../lib/cloudStore";
import { recordApiCall } from "../lib/apiHealth";
import { queuedJsonp } from "../lib/jsonpQueue";

// ============== 常量 ==============
const PUSH2 = "https://push2.eastmoney.com/api/qt";
const PUSH2HIS = "https://push2his.eastmoney.com/api/qt";
const EM_UT = "bd1d9ddb04089700cf9c27f6f7426281";

// ============== 品种行情数据 ==============
interface CommodityQuote {
  name: string;
  secid: string;
  price: number;
  pct: number;       // 日涨跌%
  pct5d: number | null;   // 近5日%
  pct20d: number | null;  // 近20日%
  chain: string;
  relatedBoards: string[];
  // 拐点标记：近20日%由负转正 或 |近20日%|>15%
  turningPoint: boolean;
}

// ============== 缓存 ==============
// 每品种每天只拉一次 kline
function klineCacheKey(name: string): string {
  const d = new Date();
  return `cmd:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}:${name}`;
}

function getKlineCache(name: string): { pct5d: number; pct20d: number } | null {
  try {
    const raw = localStorage.getItem(klineCacheKey(name));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setKlineCache(name: string, pct5d: number, pct20d: number): void {
  try { localStorage.setItem(klineCacheKey(name), JSON.stringify({ pct5d, pct20d })); }
  catch { /* 满了静默 */ }
}

// ============== 探测 secid ==============
// 逐个候选 secid 用 ulist.np 探测，取第一个有返回的
async function probeSecid(candidates: string[]): Promise<{ secid: string; price: number; pct: number } | null> {
  for (const secid of candidates) {
    try {
      const url = `${PUSH2}/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f2,f3,f4,f12,f14&secids=${secid}`;
      const json = await queuedJsonp<any>(url, 6000, "cb", 1);
      const diff = json?.data?.diff;
      const items = Array.isArray(diff) ? diff : (diff && typeof diff === "object" ? Object.values(diff) : []);
      if (items.length > 0) {
        const d = items[0] as any;
        const price = Number(d?.f2);
        if (price && Number.isFinite(price) && price > 0) {
          return { secid, price, pct: Number(d?.f3) || 0 };
        }
      }
    } catch { /* 探测失败 → 试下一个 */ }
  }
  return null; // 全部失败
}

// ============== 拉取近 N 日 kline 计算涨跌幅 ==============
async function fetchKlinePct(secid: string): Promise<{ pct5d: number | null; pct20d: number | null }> {
  try {
    const url = `${PUSH2HIS}/stock/kline/get?secid=${secid}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0&beg=0&end=20500000&lmt=25&ut=${EM_UT}`;
    const start = Date.now();
    const json = await queuedJsonp<any>(url, 8000, "cb", 1);
    recordApiCall("产业链K线", true, Date.now() - start);
    const klines: string[] = json?.data?.klines ?? [];
    if (klines.length < 2) return { pct5d: null, pct20d: null };

    // kline 格式: 日期,开盘,收盘,最高,最低,成交量,成交额
    const closes = klines.map(k => Number(k.split(",")[2]) || 0);
    const latest = closes[closes.length - 1];

    // 近5日%
    const pct5d = closes.length >= 6 && closes[closes.length - 6] > 0
      ? Math.round((latest / closes[closes.length - 6] - 1) * 10000) / 100
      : null;

    // 近20日%
    const pct20d = closes.length >= 21 && closes[closes.length - 21] > 0
      ? Math.round((latest / closes[closes.length - 21] - 1) * 10000) / 100
      : null;

    return { pct5d, pct20d };
  } catch {
    return { pct5d: null, pct20d: null };
  }
}

// ============== Props ==============
interface Props {
  /** 现有板块资金流数据（name→pct 匹配，禁止新增请求） */
  boardPcts: Record<string, number>;
}

export default function CommodityChain({ boardPcts }: Props) {
  const [quotes, setQuotes] = useState<CommodityQuote[]>([]);
  // v9.95.4：小金属快讯监测（name → 标题列表）
  const [smallMetalNews, setSmallMetalNews] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);

    const results: CommodityQuote[] = [];

    for (const spec of COMMODITY_LIST) {
      // 1. 探测 secid
      const probe = await probeSecid(spec.secidCandidates);
      if (!probe) continue; // 探测失败 → 该品种剔除

      // 2. 获取近5/20日涨跌幅（先查缓存）
      let pct5d: number | null = null;
      let pct20d: number | null = null;
      const cached = getKlineCache(spec.name);
      if (cached) {
        pct5d = cached.pct5d;
        pct20d = cached.pct20d;
      } else {
        const kdata = await fetchKlinePct(probe.secid);
        pct5d = kdata.pct5d;
        pct20d = kdata.pct20d;
        if (pct5d != null && pct20d != null) {
          setKlineCache(spec.name, pct5d, pct20d);
        }
      }

      // 3. 拐点标记
      // 口径：近20日%由负转正 或 |近20日%|>15%
      // 先于财报的景气信号：大宗价格拐点通常领先企业盈利拐点1-2个季度
      const turningPoint = pct20d != null && (
        (pct20d > 0 && pct5d != null && pct5d < 0) || // 20日正但5日负→趋势刚转
        Math.abs(pct20d) > 15 // 大幅波动
      );

      results.push({
        name: spec.name,
        secid: probe.secid,
        price: probe.price,
        pct: probe.pct,
        pct5d,
        pct20d,
        chain: spec.chain,
        relatedBoards: spec.relatedBoards,
        turningPoint,
      });
    }

    if (results.length === 0) {
      setError("待接入");
    } else {
      setQuotes(results);
      setError(null);
    }
    setLoading(false);
    // v9.95.4：小金属监测 —— 并行查本地 PG 快讯（钨/磷化铟/锑/钼），失败静默
    (async () => {
      try {
        const token = await getLocalToken();
        const out: Record<string, string[]> = {};
        await Promise.all(SMALL_METALS.map(async (sm) => {
          try {
            const resp = await fetch("/api/brain/pg", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(token ? { "x-local-token": token } : {}) },
              body: JSON.stringify({ tool: "newsByKeyword", args: { keyword: sm.keywords[0], limit: 3 } }),
            });
            const j = await resp.json();
            out[sm.name] = Array.isArray(j?.items) ? j.items.map((i: { title: string }) => i.title) : [];
          } catch { out[sm.name] = []; }
        }));
        setSmallMetalNews(out);
      } catch { /* 小金属监测失败不阻塞期货表 */ }
    })();
  }, []);

  useEffect(() => { load(); }, [load]);

  // ============== 渲染 ==============
  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="text-xs text-slate-400 animate-pulse">探测产业链期货品种…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-amber-200">🏭 产业链价格</span>
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] text-amber-300">{error}</span>
        </div>
        <div className="text-[11px] text-slate-500 mt-1">期货主连合约 secid 探测均失败，后续核实 secid 后可接入。</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="text-sm font-bold text-amber-200">🏭 产业链价格（期货代理）</div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 text-slate-400">
              <th className="px-2 py-1.5 text-left">品种</th>
              <th className="px-2 py-1.5 text-right">现价</th>
              <th className="px-2 py-1.5 text-right">日涨跌</th>
              <th className="px-2 py-1.5 text-right">近5日</th>
              <th className="px-2 py-1.5 text-right">近20日</th>
              <th className="px-2 py-1.5 text-center">信号</th>
              <th className="px-2 py-1.5 text-left">板块联动</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map(q => (
              <tr key={q.name} className={`border-b border-white/5 hover:bg-white/5 ${q.turningPoint ? "bg-amber-500/5" : ""}`}>
                <td className="px-2 py-1.5 font-medium text-slate-200">
                  <span className="group relative cursor-help">
                    {q.name}
                    {/* 传导 tooltip */}
                    <span className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-10 w-60 rounded bg-slate-800 border border-white/10 px-2 py-1.5 text-[11px] text-slate-300 shadow-lg">
                      {q.chain}
                    </span>
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right text-slate-100">{q.price.toFixed(2)}</td>
                <td className={`px-2 py-1.5 text-right font-semibold ${pctColor(q.pct)}`}>{fmtPct(q.pct)}</td>
                <td className={`px-2 py-1.5 text-right ${q.pct5d != null ? pctColor(q.pct5d) : "text-slate-500"}`}>
                  {q.pct5d != null ? fmtPct(q.pct5d) : "—"}
                </td>
                <td className={`px-2 py-1.5 text-right font-semibold ${q.pct20d != null ? pctColor(q.pct20d) : "text-slate-500"}`}>
                  {q.pct20d != null ? fmtPct(q.pct20d) : "—"}
                </td>
                <td className="px-2 py-1.5 text-center">
                  {q.turningPoint && (
                    <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-amber-500/20 text-amber-300">
                      拐点确认中
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {q.relatedBoards.map(board => {
                      // 从已有板块数据匹配今日涨跌幅（禁止新增请求）
                      const pct = boardPcts[board];
                      return (
                        <span key={board} className="text-[11px]">
                          <span className="text-slate-400">{board}</span>
                          {pct != null ? (
                            <span className={`ml-0.5 font-semibold ${pctColor(pct)}`}>{fmtPct(pct)}</span>
                          ) : (
                            <span className="ml-0.5 text-slate-600">—</span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* v9.95.4（第五段 P1）：小金属监测 —— 钨/磷化铟/锑/钼 无期货合约，快讯监测（本地 PG 优先） */}
      <div className="rounded-lg border border-fuchsia-500/20 bg-fuchsia-950/10 p-2.5">
        <div className="text-[11px] font-bold text-fuchsia-300">🔬 小金属监测（无期货 · 快讯）</div>
        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
          {SMALL_METALS.map(sm => (
            <div key={sm.name} className="rounded bg-black/20 px-2 py-1.5">
              <div className="text-[11px] font-semibold text-slate-200">{sm.name}
                <span className="ml-1 text-[10px] text-slate-600" title={sm.chain}>{sm.chain.slice(0, 18)}…</span>
              </div>
              {(smallMetalNews[sm.name] ?? []).length > 0 ? (
                <ul className="mt-0.5 list-disc pl-4 text-[10px] text-slate-400 space-y-0.5">
                  {smallMetalNews[sm.name]!.slice(0, 2).map((t, i) => <li key={i} className="truncate">{t}</li>)}
                </ul>
              ) : (
                <div className="mt-0.5 text-[10px] text-slate-600">近3日无相关快讯</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="text-[11px] text-slate-600">
        数据来源：东方财富期货主连合约行情（push2）。现货价（生意社等）待本地部署阶段接入。
        拐点标记口径：近20日涨跌幅由负转正 或 绝对值&gt;15%（先于财报的景气信号）。
      </div>
    </div>
  );
}

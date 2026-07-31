import { useState, useEffect, useCallback } from "react";
import { fmtMoney, fmtPct, pctColor } from "../lib/format";
import { stockRealUrl } from "../lib/realLinks";

// ============== 数据结构（东方财富涨停池/炸板池/跌停池真实字段） ==============
interface ZTStock {
  code: string; name: string; price: number; pct: number;
  amount: number; boardCount: number; // lbc 连板数
  firstBoardTime: string; lastBoardTime: string; // fbt/lbt 封板时间
  sealFund: number; // fund 封板资金
  blastCount: number; // zbc 炸板次数
  industry: string; // hybk 所属行业
  ztDays: number; ztCt: number; // zttj.days / zttj.ct 涨停统计
  theme: string;
}

interface ZBStock {
  code: string; name: string; price: number; pct: number;
  amount: number; industry: string;
  firstBoardTime: string; lastBoardTime: string;
  blastCount: number; sealFund: number;
  theme: string;
}

interface DTStock {
  code: string; name: string; price: number; pct: number;
  amount: number; industry: string;
  sealFund: number; lastBoardTime: string;
  openCount: number; // oc 开板次数
  days: number;
}

// ============== 题材关键词匹配 ==============
const THEME_RULES: Array<{ keywords: string[]; label: string }> = [
  { keywords: ["ST", "*ST"], label: "ST" },
  { keywords: ["重组", "并购", "借壳"], label: "并购重组" },
  { keywords: ["芯片", "半导体", "光刻", "封装", "集成电路"], label: "半导体" },
  { keywords: ["AI", "人工智能", "算力", "大模型"], label: "AI概念" },
  { keywords: ["医疗", "医药", "制药", "生物", "创新药"], label: "医药" },
  { keywords: ["军工", "航天", "国防", "兵装"], label: "军工" },
  { keywords: ["新能源", "锂电", "光伏", "储能", "风电", "电池", "电力"], label: "新能源" },
  { keywords: ["汽车", "整车", "零部"], label: "汽车" },
  { keywords: ["电子", "电网", "设备"], label: "电子设备" },
  { keywords: ["消费", "白酒", "食品", "酒店", "餐饮"], label: "消费" },
  { keywords: ["化工", "化学"], label: "化工" },
  { keywords: ["通信", "5G"], label: "通信" },
];

function matchTheme(name: string, industry: string): string {
  const text = name + industry;
  for (const rule of THEME_RULES) {
    if (rule.keywords.some(kw => text.includes(kw))) return rule.label;
  }
  return industry || "其他";
}

function themeColor(theme: string): string {
  const map: Record<string, string> = {
    "AI概念": "bg-violet-500/20 text-violet-300",
    "半导体": "bg-slate-500/20 text-slate-300",
    "并购重组": "bg-amber-500/20 text-amber-300",
    "ST": "bg-rose-500/20 text-rose-300",
    "军工": "bg-red-500/20 text-red-300",
    "新能源": "bg-green-500/20 text-green-300",
    "医药": "bg-slate-500/20 text-slate-300",
    "消费": "bg-amber-500/20 text-amber-300",
  };
  return map[theme] ?? "bg-slate-500/20 text-slate-300";
}

function boardCountColor(count: number): string {
  if (count >= 5) return "from-amber-400 to-rose-500";
  if (count >= 4) return "from-amber-400 to-rose-400";
  if (count >= 3) return "from-amber-300 to-amber-500";
  if (count >= 2) return "from-rose-400 to-rose-500";
  return "from-slate-400 to-slate-500";
}

function formatTime(t: number): string {
  const s = String(t).padStart(6, "0");
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
}

// 走全局队列，不绕过并发控制
import { queuedJsonp } from "../lib/jsonpQueue";
const jsonpReq = <T = any>(url: string, timeout = 6000) => queuedJsonp<T>(url, timeout, "cb", 2);

// ============== 数据获取（东方财富涨停池/炸板池/跌停池 真实接口） ==============
const ZT_UT = "7eea3edcaed734bea9cbfc24409ed989";

function todayStr(): string {
  const d = new Date();
  const day = d.getDay();
  // 周末取上周五
  if (day === 0) d.setDate(d.getDate() - 2);
  if (day === 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

async function fetchZTPool(date?: string): Promise<ZTStock[]> {
  const d = date || todayStr();
  const url = `https://push2ex.eastmoney.com/getTopicZTPool?ut=${ZT_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt:asc&date=${d}`;
  try {
    const json = await jsonpReq<any>(url);
    const pool: any[] = json?.data?.pool ?? [];
    return pool.map(s => ({
      code: String(s.c), name: String(s.n),
      price: (s.p ?? 0) / 1000, pct: s.zdp ?? 0,
      amount: s.amount ?? 0, boardCount: s.lbc ?? 1,
      firstBoardTime: formatTime(s.fbt ?? 0),
      lastBoardTime: formatTime(s.lbt ?? 0),
      sealFund: s.fund ?? 0, blastCount: s.zbc ?? 0,
      industry: String(s.hybk ?? ""),
      ztDays: s.zttj?.days ?? 0, ztCt: s.zttj?.ct ?? 0,
      theme: matchTheme(String(s.n ?? ""), String(s.hybk ?? "")),
    }));
  } catch { return []; }
}

async function fetchZBPool(date?: string): Promise<ZBStock[]> {
  const d = date || todayStr();
  const url = `https://push2ex.eastmoney.com/getTopicZBPool?ut=${ZT_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fund:asc&date=${d}`;
  try {
    const json = await jsonpReq<any>(url);
    const pool: any[] = json?.data?.pool ?? [];
    return pool.map(s => ({
      code: String(s.c), name: String(s.n),
      price: (s.p ?? 0) / 1000, pct: s.zdp ?? 0,
      amount: s.amount ?? 0, industry: String(s.hybk ?? ""),
      firstBoardTime: formatTime(s.fbt ?? 0),
      lastBoardTime: formatTime(s.lbt ?? 0),
      blastCount: s.zbc ?? 0, sealFund: s.fund ?? 0,
      theme: matchTheme(String(s.n ?? ""), String(s.hybk ?? "")),
    }));
  } catch { return []; }
}

async function fetchDTPool(date?: string): Promise<DTStock[]> {
  const d = date || todayStr();
  const url = `https://push2ex.eastmoney.com/getTopicDTPool?ut=${ZT_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fund:asc&date=${d}`;
  try {
    const json = await jsonpReq<any>(url);
    const pool: any[] = json?.data?.pool ?? [];
    return pool.map(s => ({
      code: String(s.c), name: String(s.n),
      price: (s.p ?? 0) / 1000, pct: s.zdp ?? 0,
      amount: s.amount ?? 0, industry: String(s.hybk ?? ""),
      sealFund: s.fund ?? 0, lastBoardTime: formatTime(s.lbt ?? 0),
      openCount: s.oc ?? 0, days: s.days ?? 0,
    }));
  } catch { return []; }
}

// ============== 统计卡片 ==============
function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-black ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

// ============== 题材热度排行 ==============
function ThemeRanking({ stocks }: { stocks: ZTStock[] }) {
  const counts = new Map<string, number>();
  for (const s of stocks) counts.set(s.theme, (counts.get(s.theme) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = sorted.length > 0 ? sorted[0][1] : 1;
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs font-bold text-amber-300 mb-2">🔥 今日涨停题材热度排行</div>
      <div className="space-y-1.5">
        {sorted.map(([theme, count]) => (
          <div key={theme} className="flex items-center gap-2 text-xs">
            <span className={`w-16 text-right shrink-0 rounded px-1 py-0.5 text-[11px] font-bold ${themeColor(theme)}`}>{theme}</span>
            <div className="flex-1 h-4 bg-slate-800 rounded overflow-hidden">
              <div className="h-full bg-gradient-to-r from-amber-500/60 to-rose-500/60 rounded" style={{ width: `${(count / max) * 100}%` }} />
            </div>
            <span className="w-8 text-right text-rose-400 font-bold">{count}只</span>
          </div>
        ))}
        {sorted.length === 0 && <div className="text-xs text-slate-500">暂无数据</div>}
      </div>
    </div>
  );
}

// ============== 连板梯队 ==============
function BoardLadder({ stocks }: { stocks: ZTStock[] }) {
  const [expanded, setExpanded] = useState(false);
    const groups = new Map<number, ZTStock[]>();
    for (const s of stocks) {
      const key = s.boardCount >= 4 ? 4 : s.boardCount;
      const arr = groups.get(key) ?? [];
      arr.push(s);
      groups.set(key, arr);
    }
    // 每组内按：近期涨停次数(ztCt)降序 → 封板时间升序 排列
    for (const [, items] of groups) {
      items.sort((a, b) => b.ztCt - a.ztCt || a.firstBoardTime.localeCompare(b.firstBoardTime));
    }
    const sortedGroups = [...groups.entries()].sort((a, b) => b[0] - a[0]);
  const label = (c: number) => c >= 4 ? "4连板+" : c === 3 ? "3连板" : c === 2 ? "2连板" : "首板";

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold text-slate-200">📊 涨停连板梯队 <span className="text-[11px] text-slate-500 font-normal ml-2">连板数=当前连续涨停天数 · 涨停统计=近期涨停总览(如"4天2板"=近4天涨停2次但非连续)</span></div>
        <button onClick={() => setExpanded(v => !v)} className="rounded px-2 py-1 text-xs bg-white/10 text-slate-300 hover:bg-white/20">
          {expanded ? "收起" : "展开全部"}
        </button>
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {sortedGroups.map(([count, items]) => (
          <div key={count} className={`rounded-lg px-3 py-2 text-center bg-gradient-to-r ${boardCountColor(count)}`}>
            <div className="text-xs text-white/80 font-bold">{label(count)}</div>
            <div className="text-lg font-black text-white">{items.length}</div>
          </div>
        ))}
      </div>
      {expanded && sortedGroups.map(([count, items]) => (
        <div key={count} className="mb-3">
          <div className={`text-xs font-bold mb-1 bg-gradient-to-r ${boardCountColor(count)} bg-clip-text text-transparent`}>
            {label(count)} ({items.length}只)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-white/10 text-slate-400">
                <th className="px-2 py-1 text-left">代码</th><th className="px-2 py-1 text-left">名称</th>
                <th className="px-2 py-1 text-right">涨跌幅</th><th className="px-2 py-1 text-center">题材</th>
                <th className="px-2 py-1 text-center">行业</th><th className="px-2 py-1 text-right">首封时间</th>
                <th className="px-2 py-1 text-right">封板资金</th><th className="px-2 py-1 text-center">炸板</th>
                <th className="px-2 py-1 text-center">涨停统计</th>
              </tr></thead>
              <tbody>
                {items.map(s => (
                  <tr key={s.code} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-2 py-1 text-slate-400">{s.code}</td>
                    <td className="px-2 py-1"><a href={stockRealUrl(s.code)} target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-amber-300">{s.name}</a></td>
                    <td className={`px-2 py-1 text-right font-semibold ${pctColor(s.pct)}`}>{fmtPct(s.pct)}</td>
                    <td className="px-2 py-1 text-center"><span className={`rounded px-1 py-0.5 text-[11px] font-bold ${themeColor(s.theme)}`}>{s.theme}</span></td>
                    <td className="px-2 py-1 text-center text-slate-500 text-[11px]">{s.industry}</td>
                    <td className="px-2 py-1 text-right text-slate-300">{s.firstBoardTime}</td>
                    <td className="px-2 py-1 text-right text-rose-400">{fmtMoney(s.sealFund)}</td>
                    <td className="px-2 py-1 text-center">{s.blastCount > 0 ? <span className="text-amber-400">{s.blastCount}次</span> : <span className="text-slate-600">0</span>}</td>
                    <td className="px-2 py-1 text-center">
                      <span className={`${s.ztCt >= 2 && s.boardCount === 1 ? "text-amber-300 font-semibold" : "text-slate-300"}`}>
                        {s.ztDays}天{s.ztCt}板
                      </span>
                      {s.ztCt >= 2 && s.boardCount === 1 && (
                        <span className="ml-1 rounded px-1 py-0.5 text-[11px] bg-amber-500/20 text-amber-300">非连续</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============== 主组件 ==============
export default function LimitBoard() {
  const [ztStocks, setZtStocks] = useState<ZTStock[]>([]);
  const [zbStocks, setZbStocks] = useState<ZBStock[]>([]);
  const [dtStocks, setDtStocks] = useState<DTStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateStr, setDateStr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const d = todayStr();
    setDateStr(d);
    const [zt, zb, dt] = await Promise.all([fetchZTPool(d), fetchZBPool(d), fetchDTPool(d)]);
    // 如果今天没数据（非交易日/盘前），尝试前一天
    if (zt.length === 0 && zb.length === 0 && dt.length === 0) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yd = `${yesterday.getFullYear()}${String(yesterday.getMonth() + 1).padStart(2, "0")}${String(yesterday.getDate()).padStart(2, "0")}`;
      setDateStr(yd);
      const [zt2, zb2, dt2] = await Promise.all([fetchZTPool(yd), fetchZBPool(yd), fetchDTPool(yd)]);
      setZtStocks(zt2); setZbStocks(zb2); setDtStocks(dt2);
    } else {
      setZtStocks(zt); setZbStocks(zb); setDtStocks(dt);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-400">正在加载涨停板复盘数据…</div>;

      const limitUpCount = ztStocks.length;
      const blastedCount = zbStocks.length;
      const limitDownCount = dtStocks.length;
      const blastedRate = (limitUpCount + blastedCount) > 0 ? blastedCount / (limitUpCount + blastedCount) * 100 : 0;
      
      // 晋级率：昨日 lbc===1（首板）的个股中，今日 lbc>=2（继续涨停）的比例
      // 需要昨日涨停池快照数据，从 localStorage 加载
      let promotionRate: number | null = null;
      try {
        const today = new Date().toISOString().slice(0, 10);
        const d = new Date(today + "T00:00:00+08:00");
        const yesterday = new Date(d.getTime() - 86400000);
        const yd = yesterday.toISOString().slice(0, 10).replace(/-/g, "");
        const snapshotRaw = localStorage.getItem(`ztpool:${yd}`);
        if (snapshotRaw) {
          const yesterdayPool: any[] = JSON.parse(snapshotRaw);
          // 昨日首板股（lbc===1）
          const yesterdayFirstBoard = yesterdayPool.filter((s: any) => (s.lbc ?? 1) === 1);
          if (yesterdayFirstBoard.length > 0) {
            // 今日这些股票的代码集合（去重）
            const yesterdayFirstBoardCodes = new Set(yesterdayFirstBoard.map((s: any) => String(s.c)));
            // 今日这些股票中 lbc>=2 的数量
            let promotedCount = 0;
            for (const todayStock of ztStocks) {
              if (yesterdayFirstBoardCodes.has(todayStock.code) && todayStock.boardCount >= 2) {
                promotedCount++;
              }
            }
            promotionRate = Math.round(promotedCount / yesterdayFirstBoard.length * 1000) / 1000;
          }
        }
      } catch { /* 昨日快照缺失或解析失败，promotionRate 保持 null */ }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-amber-500/20 bg-amber-950/10 px-4 py-2 text-xs text-amber-300/90">
        涨停板复盘（{dateStr}） — 数据来源：东方财富涨停池/炸板池/跌停池真实接口（push2ex） · 所有数据均为真实数据
      </div>

      {/* 核心统计 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="今日涨停" value={limitUpCount} sub="只（封板中）" color="text-rose-400" />
        <StatCard label="今日跌停" value={limitDownCount} sub="只" color="text-emerald-400" />
        <StatCard label="炸板数量" value={blastedCount} sub="只（曾涨停未封住）" color="text-amber-400" />
        <StatCard label="炸板率" value={`${blastedRate.toFixed(1)}%`} sub="炸板/(涨停+炸板)" color="text-amber-300" />
        <StatCard label="晋级率" value={promotionRate != null ? `${(promotionRate * 100).toFixed(1)}%` : "—"} sub="昨日首板今日2连板+比例" color="text-slate-400" />
      </div>

      {/* 题材热度 + 连板梯队 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ThemeRanking stocks={ztStocks} />
        <div className="lg:col-span-2"><BoardLadder stocks={ztStocks} /></div>
      </div>

      {/* 炸板股观察 */}
      {zbStocks.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="text-sm font-bold text-amber-300 mb-2">💥 炸板股观察（{zbStocks.length}只，次日重点关注）</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-amber-500/20 text-slate-400">
                <th className="px-2 py-1.5 text-left">代码</th><th className="px-2 py-1.5 text-left">名称</th>
                <th className="px-2 py-1.5 text-right">收盘涨幅</th><th className="px-2 py-1.5 text-center">题材</th>
                <th className="px-2 py-1.5 text-right">首封时间</th><th className="px-2 py-1.5 text-center">炸板次数</th>
                <th className="px-2 py-1.5 text-right">成交额</th>
              </tr></thead>
              <tbody>
                {zbStocks.map(s => (
                  <tr key={s.code} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-2 py-1.5 text-slate-400">{s.code}</td>
                    <td className="px-2 py-1.5"><a href={stockRealUrl(s.code)} target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-amber-300">{s.name}</a></td>
                    <td className={`px-2 py-1.5 text-right font-semibold ${pctColor(s.pct)}`}>{fmtPct(s.pct)}</td>
                    <td className="px-2 py-1.5 text-center"><span className={`rounded px-1 py-0.5 text-[11px] font-bold ${themeColor(s.theme)}`}>{s.theme}</span></td>
                    <td className="px-2 py-1.5 text-right text-slate-300">{s.firstBoardTime}</td>
                    <td className="px-2 py-1.5 text-center text-amber-400">{s.blastCount}次</td>
                    <td className="px-2 py-1.5 text-right text-slate-300">{fmtMoney(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 跌停板 */}
      {dtStocks.length > 0 && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="text-sm font-bold text-emerald-300 mb-2">📉 跌停板（{dtStocks.length}只）</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-emerald-500/20 text-slate-400">
                <th className="px-2 py-1.5 text-left">代码</th><th className="px-2 py-1.5 text-left">名称</th>
                <th className="px-2 py-1.5 text-right">涨跌幅</th><th className="px-2 py-1.5 text-right">现价</th>
                <th className="px-2 py-1.5 text-center">行业</th><th className="px-2 py-1.5 text-right">封单资金</th>
                <th className="px-2 py-1.5 text-center">开板次数</th><th className="px-2 py-1.5 text-right">成交额</th>
              </tr></thead>
              <tbody>
                {dtStocks.map(s => (
                  <tr key={s.code} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-2 py-1.5 text-slate-400">{s.code}</td>
                    <td className="px-2 py-1.5"><a href={stockRealUrl(s.code)} target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-amber-300">{s.name}</a></td>
                    <td className={`px-2 py-1.5 text-right font-semibold ${pctColor(s.pct)}`}>{fmtPct(s.pct)}</td>
                    <td className="px-2 py-1.5 text-right text-slate-100">{s.price.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-center text-slate-500">{s.industry}</td>
                    <td className="px-2 py-1.5 text-right text-emerald-400">{fmtMoney(s.sealFund)}</td>
                    <td className="px-2 py-1.5 text-center">{s.openCount > 0 ? <span className="text-amber-400">{s.openCount}次</span> : <span className="text-slate-600">0</span>}</td>
                    <td className="px-2 py-1.5 text-right text-slate-300">{fmtMoney(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(ztStocks.length === 0 && zbStocks.length === 0 && dtStocks.length === 0) && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-300 text-sm">
          暂无涨停板数据。涨停池数据通常在交易日9:30开盘后实时更新。
        </div>
      )}

      <div className="text-[11px] text-slate-600 leading-relaxed">
        所有数据来自东方财富涨停池(getTopicZTPool)/炸板池(getTopicZBPool)/跌停池(getTopicDTPool)真实接口。
        连板数、封板时间、炸板次数、封板资金均为真实数据。
        <a href="https://quote.eastmoney.com/ztb/" target="_blank" rel="noopener noreferrer" className="text-amber-300 hover:underline ml-1">查看东方财富涨停板行情 →</a>
      </div>
    </section>
  );
}

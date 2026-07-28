import { useState, useEffect, useCallback, Fragment } from "react";
import { fetchDragonTigerList, fetchDragonTigerSeats, type DragonTigerItem, type DragonTigerSeat } from "../lib/api";
import { fmtMoney, fmtPct, pctColor } from "../lib/format";
import { stockRealUrl } from "../lib/realLinks";

// ============== 知名游资/机构营业部标签库 ==============
const KNOWN_TAGS: Array<{ keywords: string[]; label: string; color: string }> = [
  { keywords: ["机构专用"], label: "机构席位", color: "bg-blue-500/20 text-blue-300" },
  { keywords: ["沪股通专用", "深股通专用"], label: "北向资金", color: "bg-slate-500/20 text-slate-300" },
  // 知名游资营业部关键词
  { keywords: ["华鑫证券上海分公司", "华鑫上海分"], label: "知名游资", color: "bg-orange-500/20 text-orange-300" },
  { keywords: ["东方财富拉萨"], label: "知名游资(拉萨帮)", color: "bg-orange-500/20 text-orange-300" },
  { keywords: ["国泰海通上海江苏路", "国泰君安上海江苏路"], label: "知名游资(章盟主)", color: "bg-orange-500/20 text-orange-300" },
  { keywords: ["中国银河绍兴"], label: "知名游资(赵老哥)", color: "bg-orange-500/20 text-orange-300" },
  { keywords: ["华泰南京太平南路", "华泰证券南京太平南路"], label: "知名游资", color: "bg-orange-500/20 text-orange-300" },
  { keywords: ["中信建投杭州"], label: "知名游资", color: "bg-orange-500/20 text-orange-300" },
  { keywords: ["国泰海通成都北一环", "国泰君安成都北一环"], label: "知名游资", color: "bg-orange-500/20 text-orange-300" },
  { keywords: ["开源证券西安太华路"], label: "知名游资", color: "bg-orange-500/20 text-orange-300" },
  { keywords: ["中国中金财富深圳深南大道"], label: "知名游资", color: "bg-orange-500/20 text-orange-300" },
  { keywords: ["东方证券上海浦东新区源深路"], label: "知名游资", color: "bg-orange-500/20 text-orange-300" },
  // 量化
  { keywords: ["量化", "对冲"], label: "量化席位", color: "bg-violet-500/20 text-violet-300" },
];

function getDeptTag(name: string): { label: string; color: string } | null {
  for (const tag of KNOWN_TAGS) {
    if (tag.keywords.some(kw => name.includes(kw))) return tag;
  }
  return null;
}

// 上榜原因标签颜色
function reasonColor(explanation: string): string {
  if (explanation.includes("涨幅偏离")) return "bg-rose-500/20 text-rose-300";
  if (explanation.includes("跌幅偏离")) return "bg-emerald-500/20 text-emerald-300";
  if (explanation.includes("换手率")) return "bg-amber-500/20 text-amber-300";
  if (explanation.includes("振幅")) return "bg-purple-500/20 text-purple-300";
  if (explanation.includes("连续三个交易日")) return "bg-sky-500/20 text-sky-300";
  return "bg-slate-500/20 text-slate-300";
}

function SeatTable({ seats, type }: { seats: DragonTigerSeat[]; type: "buy" | "sell" }) {
  const isBuy = type === "buy";
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className={`border-b ${isBuy ? "border-rose-500/20" : "border-emerald-500/20"} text-slate-400`}>
          <th className="px-2 py-1.5 text-left">{isBuy ? "买入" : "卖出"}席位</th>
          <th className="px-2 py-1.5 text-right">买入额</th>
          <th className="px-2 py-1.5 text-right">卖出额</th>
          <th className="px-2 py-1.5 text-right">净额</th>
        </tr>
      </thead>
      <tbody>
        {seats.map((s, i) => {
          const tag = getDeptTag(s.deptName);
          return (
            <tr key={i} className={`border-b border-white/5 ${isBuy ? "bg-rose-500/5" : "bg-emerald-500/5"}`}>
              <td className="px-2 py-1.5 text-slate-200">
                <span className="mr-1">{s.deptName}</span>
                {tag && <span className={`rounded px-1 py-0.5 text-[11px] font-bold ${tag.color}`}>{tag.label}</span>}
              </td>
              <td className="px-2 py-1.5 text-right text-rose-400">{fmtMoney(s.buy)}</td>
              <td className="px-2 py-1.5 text-right text-emerald-400">{fmtMoney(s.sell)}</td>
              <td className={`px-2 py-1.5 text-right font-semibold ${pctColor(s.net)}`}>{fmtMoney(s.net)}</td>
            </tr>
          );
        })}
        {seats.length === 0 && (
          <tr><td colSpan={4} className="px-2 py-3 text-center text-slate-500">暂无数据</td></tr>
        )}
      </tbody>
    </table>
  );
}

// ============== 游资联动统计（模拟） ==============
function HotMoneyStats({ items }: { items: DragonTigerItem[] }) {
  // 统计同一上榜原因出现的频率，作为题材热度参考
  const reasonCounts = new Map<string, number>();
  for (const item of items) {
    const reason = item.explanation.replace(/的前5只证券|的前五只证券/g, "").trim();
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const topReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  // 统计净买入最多的个股
  const topBuyers = [...items].sort((a, b) => b.netAmt - a.netAmt).filter(i => i.netAmt > 0).slice(0, 5);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="text-xs font-bold text-amber-300 mb-2">🔥 游资联动 · 上榜原因分布</div>
        {topReasons.length === 0 ? (
          <div className="text-xs text-slate-500">暂无数据</div>
        ) : (
          <div className="space-y-1.5">
            {topReasons.map(([reason, count]) => (
              <div key={reason} className="flex items-center justify-between text-xs">
                <span className={`rounded px-1.5 py-0.5 ${reasonColor(reason)}`}>{reason}</span>
                <span className="text-slate-300 font-semibold">{count}只</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="text-xs font-bold text-emerald-300 mb-2">💰 龙虎榜净买入 Top5</div>
        {topBuyers.length === 0 ? (
          <div className="text-xs text-slate-500">暂无数据</div>
        ) : (
          <div className="space-y-1.5">
            {topBuyers.map(item => (
              <div key={item.code} className="flex items-center justify-between text-xs">
                <a href={stockRealUrl(item.code)} target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-amber-300">
                  {item.name}({item.code})
                </a>
                <span className="text-rose-400 font-semibold">{fmtMoney(item.netAmt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============== 龙虎榜历史表现统计 ==============
function HistoryPerformance({ items }: { items: DragonTigerItem[] }) {
  // 统计有历史涨跌数据的条目（d1Pct !== null 且不是0 — 真实值可以为0但API返回null表示无数据）
  const withHistory = items.filter(i => i.d1Pct !== null);
  if (withHistory.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="text-xs font-bold text-sky-300 mb-2">📈 龙虎榜历史表现统计</div>
        <div className="text-xs text-slate-500">当前批次龙虎榜尚无后续涨跌数据（最新一期需等待后续交易日收盘后更新）。该功能需要历史龙虎榜数据中包含上榜后的后续行情，当API返回的后续涨跌字段不为null时自动计算。</div>
      </div>
    );
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  const winRate = (arr: number[]) => arr.length ? (arr.filter(v => v > 0).length / arr.length * 100) : 0;
  const d1 = withHistory.map(i => i.d1Pct!);
  const d2 = withHistory.filter(i => i.d2Pct != null).map(i => i.d2Pct!);
  const d5 = withHistory.filter(i => i.d5Pct != null).map(i => i.d5Pct!);
  const d10 = withHistory.filter(i => i.d10Pct != null).map(i => i.d10Pct!);

  const stats = [
    { label: "次日", avg: avg(d1), win: winRate(d1), count: d1.length },
    { label: "3日后", avg: avg(d2), win: winRate(d2), count: d2.length },
    { label: "5日后", avg: avg(d5), win: winRate(d5), count: d5.length },
    { label: "10日后", avg: avg(d10), win: winRate(d10), count: d10.length },
  ];

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs font-bold text-sky-300 mb-2">📈 龙虎榜历史表现统计（基于{withHistory.length}条有后续数据的记录）</div>
      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        {stats.map(d => (
          <div key={d.label} className="rounded-lg bg-black/20 p-2">
            <div className="text-slate-400">{d.label}</div>
            <div className={`font-semibold mt-1 ${pctColor(d.avg)}`}>{d.avg >= 0 ? "+" : ""}{d.avg.toFixed(2)}%</div>
            <div className={`text-[11px] ${d.win >= 50 ? "text-rose-400" : "text-emerald-400"}`}>胜率 {d.win.toFixed(0)}%</div>
            <div className="text-[11px] text-slate-600">({d.count}条)</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============== 主组件 ==============
export default function DragonTiger() {
  const [items, setItems] = useState<DragonTigerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [seats, setSeats] = useState<Record<string, { buy: DragonTigerSeat[]; sell: DragonTigerSeat[] }>>({});
  const [seatsLoading, setSeatsLoading] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const list = await fetchDragonTigerList(80);
    setItems(list);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = async (item: DragonTigerItem) => {
    const key = `${item.code}_${item.tradeDate}`;
    const isExpanding = !expanded[key];
    setExpanded(prev => ({ ...prev, [key]: isExpanding }));

    if (isExpanding && !seats[key]) {
      setSeatsLoading(prev => ({ ...prev, [key]: true }));
      const result = await fetchDragonTigerSeats(item.code, item.tradeDate);
      setSeats(prev => ({ ...prev, [key]: result }));
      setSeatsLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  // 按日期分组
  const dateGroups = new Map<string, DragonTigerItem[]>();
  for (const item of items) {
    const arr = dateGroups.get(item.tradeDate) ?? [];
    arr.push(item);
    dateGroups.set(item.tradeDate, arr);
  }

  if (loading) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-400">正在加载龙虎榜数据…</div>;
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-amber-500/20 bg-amber-950/10 px-4 py-2 text-xs text-amber-300/90">
        龙虎榜与游资席位追踪 — 数据来源：东方财富数据中心龙虎榜接口（datacenter-web.eastmoney.com）· 实时更新
      </div>

      {/* 统计卡片 */}
      <HotMoneyStats items={items} />
      <HistoryPerformance items={items} />

      {/* 龙虎榜列表 */}
      {[...dateGroups.entries()].map(([date, dateItems]) => (
        <div key={date} className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
          <div className="bg-white/5 px-4 py-2 text-sm font-bold text-slate-200">
            📋 {date} 龙虎榜（{dateItems.length}只）
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-white/5 text-xs text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left w-8"></th>
                  <th className="px-3 py-2 text-left">代码</th>
                  <th className="px-3 py-2 text-left">名称</th>
                  <th className="px-3 py-2 text-right">现价</th>
                  <th className="px-3 py-2 text-right">涨跌幅</th>
                  <th className="px-3 py-2 text-right">净买入</th>
                  <th className="px-3 py-2 text-center">上榜原因</th>
                  <th className="px-3 py-2 text-center">说明</th>
                </tr>
              </thead>
              <tbody>
                {dateItems.map(item => {
                  const key = `${item.code}_${item.tradeDate}`;
                  const isExp = expanded[key];
                  const seatData = seats[key];
                  return (
                    <Fragment key={key}>
                      <tr className="border-t border-white/5 hover:bg-white/5 cursor-pointer" onClick={() => toggleExpand(item)}>
                        <td className="px-3 py-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-white/10 text-xs text-slate-300">
                            {isExp ? "−" : "+"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-400 text-xs">{item.code}</td>
                        <td className="px-3 py-2 font-medium text-slate-100">
                          <a href={stockRealUrl(item.code)} target="_blank" rel="noopener noreferrer" className="hover:text-amber-300">
                            {item.name}
                          </a>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-100">{item.closePrice.toFixed(2)}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${pctColor(item.changeRate)}`}>{fmtPct(item.changeRate)}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${pctColor(item.netAmt)}`}>{fmtMoney(item.netAmt)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${reasonColor(item.explanation)}`}>
                            {item.explanation.replace(/的前5只证券|的前五只证券/g, "")}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center text-[11px] text-slate-400">{item.explain}</td>
                      </tr>
                      {isExp && (
                        <tr>
                          <td colSpan={8} className="bg-black/30 px-4 py-3">
                            {seatsLoading[key] ? (
                              <div className="text-xs text-slate-500">加载席位数据中…</div>
                            ) : seatData ? (
                              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                <div>
                                  <div className="text-xs font-bold text-rose-400 mb-1">买入前五</div>
                                  <SeatTable seats={seatData.buy} type="buy" />
                                </div>
                                <div>
                                  <div className="text-xs font-bold text-emerald-400 mb-1">卖出前五</div>
                                  <SeatTable seats={seatData.sell} type="sell" />
                                </div>
                              </div>
                            ) : (
                              <div className="text-xs text-slate-500">暂无席位数据</div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {items.length === 0 && !loading && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-300 text-sm">
          暂无龙虎榜数据。龙虎榜数据通常在收盘后由交易所公布。
        </div>
      )}

      <div className="text-[11px] text-slate-600 leading-relaxed">
        数据来源：东方财富数据中心龙虎榜接口。营业部标签为初版关键词匹配，可扩展。
        历史表现统计基于已有后续涨跌数据的记录计算，最新一期可能尚无后续数据。
        <a href="https://data.eastmoney.com/stock/tradedetail.html" target="_blank" rel="noopener noreferrer" className="text-amber-300 hover:underline ml-1">
          查看东方财富龙虎榜 →
        </a>
      </div>
    </section>
  );
}

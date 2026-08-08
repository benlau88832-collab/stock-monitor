import { fmtPct, fmtMoney, pctColor } from "../lib/format";
import { indexRealUrl, marketBreadthUrl } from "../lib/realLinks";
import type { OverviewData, SentimentFactors } from "../App";
import FreshnessTag from "./FreshnessTag";

// ============== 五级色阶 ==============
function sentimentColor(value: number): string {
  if (value >= 80) return "#ef4444"; // 极度贪婪 - 红
  if (value >= 65) return "#f97316"; // 贪婪 - 橙
  if (value >= 45) return "#eab308"; // 中性 - 黄
  if (value >= 25) return "#3b82f6"; // 恐慌 - 蓝
  return "#6366f1"; // 极度恐慌 - 紫
}

function sentimentBgClass(value: number): string {
  if (value >= 80) return "border-red-500/40 bg-red-500/10";
  if (value >= 65) return "border-amber-500/40 bg-amber-500/10";
  if (value >= 45) return "border-amber-500/30 bg-amber-500/10";
  if (value >= 25) return "border-slate-500/30 bg-slate-500/10";
  return "border-violet-500/30 bg-violet-500/10";
}

// ============== 情绪温度计（升级版） ==============
function SentimentGauge({ value, label, factors, yesterday, premiumAvg, promotionRate, maxBoardHeight }: {
  value: number; label: string;
  factors: SentimentFactors | null;
  yesterday: number | null;
  premiumAvg?: number | null;
  promotionRate?: number | null;
  maxBoardHeight?: number | null;
}) {
  const color = sentimentColor(value);
  const delta = yesterday != null ? value - yesterday : null;

  return (
    <div className={`rounded-xl border p-4 ${sentimentBgClass(value)} space-y-3`}>
      {/* 仪表盘 */}
      <div className="flex items-center gap-4">
        <div className="relative h-24 w-24 shrink-0">
          <svg viewBox="0 0 36 36" className="h-24 w-24 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="#1e293b" strokeWidth="3.5" />
            <circle cx="18" cy="18" r="15.5" fill="none" stroke={color} strokeWidth="3.5"
              strokeDasharray={`${(value / 100) * 97.4} 97.4`} strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-xl font-black" style={{ color }}>{value}</div>
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wider text-slate-400">情绪温度计</div>
          <div className="text-base font-black" style={{ color }}>{label}</div>
          {delta != null && (
            <div className={`text-xs font-semibold ${delta > 0 ? "text-rose-400" : delta < 0 ? "text-emerald-400" : "text-slate-400"}`}>
              较上次 {delta > 0 ? "↑" : delta < 0 ? "↓" : "→"}{delta > 0 ? "+" : ""}{delta}分
            </div>
          )}
          {/* 五级色阶图例 */}
          <div className="flex gap-0.5 mt-1">
            {[
              { label: "极度恐慌", color: "bg-violet-500", range: "0-24" },
              { label: "恐慌", color: "bg-slate-500", range: "25-44" },
              { label: "中性", color: "bg-amber-500", range: "45-64" },
              { label: "贪婪", color: "bg-amber-500", range: "65-79" },
              { label: "极度贪婪", color: "bg-red-500", range: "80-100" },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className={`h-1.5 w-8 rounded-sm ${s.color}`} />
                <div className="text-[11px] text-slate-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
          {/* v12-7（P1）：历史分位数 —— 显式标注"开发中"（原暗色 text-slate-700 几乎不可见，用户误以为数据缺失异常） */}
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-bold text-amber-300">开发中</span>
            <span>历史分位数（接入 250 日历史数据后启用）</span>
          </div>
        </div>
      </div>

      {/* 因子明细 */}
      {factors && (
        <div className="border-t border-white/10 pt-2">
          <div className="text-[11px] font-bold text-slate-400 mb-1">计分因子明细</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
            {[
              { name: "涨跌家数比", score: factors.upDownScore },
              { name: "涨跌停差值", score: factors.limitScore },
              { name: "平均涨跌幅", score: factors.avgPctScore },
              { name: "指数涨跌幅", score: factors.indexScore },
              { name: "涨停活跃度", score: factors.limitUpBonus },
              { name: "炸板率扣分", score: -factors.blastedPenalty },
              { name: "主力资金方向", score: factors.fundFlowScore },
              { name: "昨日涨停溢价", score: factors.premiumScore },
              { name: "连板晋级率", score: factors.promotionScore },
              { name: "基础分", score: 15 },
            ].map(f => (
              <div key={f.name} className="flex items-center justify-between">
                <span className="text-slate-500">{f.name}</span>
                <span className={`font-semibold ${f.score > 0 ? "text-rose-400" : f.score < 0 ? "text-emerald-400" : "text-slate-500"}`}>
                  {f.score > 0 ? "+" : ""}{f.score.toFixed(1)}
                </span>
              </div>
            ))}
            {/* 溢价/晋级率/最高板原始值展示 */}
            <div className="col-span-2 border-t border-white/5 pt-1 mt-1 space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">昨日涨停溢价</span>
                <span className={`font-semibold ${premiumAvg != null ? (premiumAvg > 0 ? "text-rose-400" : "text-emerald-400") : "text-slate-600"}`}>
                  {premiumAvg != null ? `${premiumAvg >= 0 ? "+" : ""}${premiumAvg.toFixed(2)}%` : "数据积累中"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">连板晋级率</span>
                <span className={`font-semibold ${promotionRate != null ? (promotionRate >= 0.3 ? "text-rose-400" : promotionRate < 0.1 ? "text-emerald-400" : "text-slate-300") : "text-slate-600"}`}>
                  {promotionRate != null ? `${(promotionRate * 100).toFixed(1)}%` : "无样本/数据积累中"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">市场最高板</span>
                <span className="font-semibold text-amber-300">
                  {maxBoardHeight != null ? `${maxBoardHeight}板` : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============== 成交额量能判断标签 ==============
function VolumeTag({ avgPct, turnoverAmount, turnoverYesterday, turnoverAvg5d }: {
  avgPct: number; turnoverAmount: number;
  turnoverYesterday: number | null; turnoverAvg5d: number | null;
}) {
  if (turnoverAmount <= 0) return null;
  // 用昨日成交额对比判断放量/缩量，如果没有昨日数据则用5日均值
  const compareBase = turnoverYesterday ?? turnoverAvg5d;
  if (!compareBase || compareBase <= 0) return null;

  const ratio = turnoverAmount / compareBase;
  const isUp = avgPct > 0.3;
  const isDown = avgPct < -0.3;
  const isVolUp = ratio > 1.05; // 成交额比基准多5%以上=放量

  let tag = "";
  let tagColor = "";
  if (isUp && isVolUp) { tag = "放量上涨"; tagColor = "bg-rose-500/20 text-rose-300"; }
  else if (isUp && !isVolUp) { tag = "缩量上涨"; tagColor = "bg-amber-500/20 text-amber-300"; }
  else if (isDown && isVolUp) { tag = "放量下跌"; tagColor = "bg-rose-500/20 text-rose-300"; }
  else if (isDown && !isVolUp) { tag = "缩量下跌"; tagColor = "bg-emerald-500/20 text-emerald-300"; }
  else { tag = "横盘整理"; tagColor = "bg-slate-500/20 text-slate-300"; }

  const pctChange = ((ratio - 1) * 100).toFixed(1);
  return (
    <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-bold ${tagColor}`}>
      {tag}（较昨日{Number(pctChange) >= 0 ? "+" : ""}{pctChange}%）
    </span>
  );
}

// ============== 主组件 ==============
export default function MarketOverview({ data, loading }: { data: OverviewData | null; loading: boolean }) {
  if (!data && loading) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-400">正在加载市场概览…</div>;
  }
  if (!data) {
    return <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-300">市场概览数据获取失败</div>;
  }

  const { indices, breadth, sentiment, sentimentLabel, sentimentFactors, sentimentYesterday, limitPool, turnoverAmount, turnoverYesterday, turnoverAvg5d, premiumAvg, promotionRate, maxBoardHeight, fetchedAt } = data;

  // 连板分布文字
  const boardDistText = limitPool ? Object.entries(limitPool.boardCounts)
    .sort(([a], [b]) => Number(b) - Number(a))
    .filter(([k]) => Number(k) >= 2)
    .map(([k, v]) => `${k}板${v}只`)
    .join(" · ") || "无" : "";

  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <div className="flex items-center text-[11px] text-slate-500">📊 市场概览 <FreshnessTag type="realtime" /></div>
        {/* 指数卡片 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {indices.length === 0 && (
            <div className="col-span-full rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              指数行情数据不完整，请稍后重试
            </div>
          )}
          {indices.map((idx) => (
            <a key={idx.code} href={indexRealUrl(idx.code, idx.name)} target="_blank" rel="noopener noreferrer"
              className="rounded-xl border border-white/10 bg-white/5 p-3 hover:border-amber-400/30 hover:bg-white/10 transition block">
              <div className="text-xs text-slate-400">{idx.name}</div>
              <div className="mt-1 text-lg font-bold text-slate-50">{idx.price?.toFixed(2)}</div>
              <div className={`text-sm font-semibold ${pctColor(idx.pct)}`}>{fmtPct(idx.pct)}</div>
            </a>
          ))}
        </div>

        {/* 涨跌家数 + 涨停池数据 */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          {!breadth ? (
            // v9.77（A5-P1-3）：区分"加载中"与"接口失败"——原静默挂"加载中"误导
            <div className="text-xs text-amber-300">{loading ? "市场宽度数据加载中…" : "⚠ 市场宽度数据不可用（接口失败），情绪分基于指数/资金近似"}</div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <a href={marketBreadthUrl()} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-amber-300">
                  全市场 <b className="text-slate-100">{breadth.total}</b> 只
                </a>
                <span className="text-rose-400">上涨 <b>{breadth.up}</b></span>
                <span className="text-emerald-400">下跌 <b>{breadth.down}</b></span>
                <span className="text-slate-400">平盘 <b>{breadth.flat}</b></span>
                <span className="text-rose-300">涨停 <b>{limitPool?.limitUpCount ?? 0}</b></span>
                {/* v12-6（P1）：涨停池可能截断 → 显式警告 */}
                {limitPool?.truncated && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-bold text-amber-300" title={limitPool.truncated}>
                    ⚠ 可能截断
                  </span>
                )}
                {/* v9.77（P0-6 修复）：涨停池数据非今日（接口失败静默回退）→ 明示数据日期，防止把昨日涨停数当今日 */}
                {limitPool?.degraded && limitPool.qdate && (
                  <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-xs font-bold text-rose-300"
                    title="接口失败/异常时回退到最近有数据的交易日，当前涨停/炸板/连板均为该日数据，非今日实时">
                    ⚠ 数据来自 {limitPool.qdate.slice(4, 6)}-{limitPool.qdate.slice(6, 8)}（接口异常）
                  </span>
                )}
                <span className="text-emerald-300">跌停 <b>{limitPool?.limitDownCount ?? 0}</b></span>
                {limitPool && (
                  <>
                    <span className="text-amber-300">炸板 <b>{limitPool.blastedCount}</b> <span className="text-[11px]">({limitPool.blastedRate.toFixed(0)}%)</span></span>
                    {boardDistText && <span className="text-slate-300 text-xs">连板: {boardDistText}</span>}
                  </>
                )}
              </div>

              {/* 进度条 */}
              {breadth.total > 0 && (
                <div className="flex h-3 rounded overflow-hidden">
                  <div className="bg-rose-500" style={{ width: `${(breadth.up / breadth.total) * 100}%` }} title={`上涨 ${breadth.up}`} />
                  <div className="bg-slate-600" style={{ width: `${(breadth.flat / breadth.total) * 100}%` }} title={`平盘 ${breadth.flat}`} />
                  <div className="bg-emerald-500" style={{ width: `${(breadth.down / breadth.total) * 100}%` }} title={`下跌 ${breadth.down}`} />
                </div>
              )}

              {/* 平均涨跌幅 + 成交额 + 量能标签 */}
              <div className="flex flex-wrap items-center gap-x-4 text-xs">
                <span className="text-slate-400">
                  平均涨跌幅 <b className={pctColor(breadth.avgPct)}>{fmtPct(breadth.avgPct)}</b>
                  <VolumeTag avgPct={breadth.avgPct} turnoverAmount={turnoverAmount} turnoverYesterday={turnoverYesterday} turnoverAvg5d={turnoverAvg5d} />
                </span>
                {turnoverAmount > 0 && (
                  <span className="text-slate-400">两市成交 <b className="text-slate-200">{fmtMoney(turnoverAmount)}</b></span>
                )}
              </div>

              <div className="text-[11px] text-amber-300/60">
                数据来源：东方财富push2行情+涨停池接口 ·{" "}
                <a href={marketBreadthUrl()} target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-300">点击验证 →</a>
                {/* v9.77（P0-5）：数据截至时间 —— 明确告知数据年龄，防止按旧数据决策 */}
                {fetchedAt && <span className="text-slate-500"> · 数据截至 {new Date(fetchedAt).toTimeString().slice(0, 8)}</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 右侧：情绪温度计（升级版） */}
      <SentimentGauge value={sentiment ?? 0} label={sentimentLabel} factors={sentimentFactors} yesterday={sentimentYesterday} premiumAvg={premiumAvg} promotionRate={promotionRate} maxBoardHeight={maxBoardHeight} />
    </section>
  );
}

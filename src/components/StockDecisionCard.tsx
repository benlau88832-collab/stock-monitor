// 个股决策卡（v9.24-P1-2，PRD C1）
// 个股雷达页选中个股首屏：一句话结论/主线归属/技术位置/资金性质/风险点/止损止盈/置信度
// 实现：纯规则引擎基于现有实时数据（零额外请求、零等待），符合 PRD "决策卡先于信息流"
import { fmtMoney, fmtPct } from "../lib/format";
import type { WatchStock, VetoItem } from "./StockWatchlist";
import DisclaimerTag from "./DisclaimerTag";

interface Props {
  stock: WatchStock;
  vetoList: VetoItem[];
  /** 今日主线名称列表（由 App 传入 battlePlan.candidates），用于主线归属判断 */
  mainlines?: string[];
}

// ============== 规则引擎 ==============

/** 技术位置：基于涨跌幅+量比+换手率近似（无均线数据时的代理口径） */
function techPosition(s: WatchStock): { label: string; color: string; desc: string } {
  const up = s.pct >= 7;
  const highVolume = (s.volumeRatio ?? 0) >= 2;
  const hotTurnover = (s.turnoverRate ?? 0) >= 10;
  if (up && highVolume) return { label: "高位放量", color: "text-rose-300", desc: `+${s.pct.toFixed(1)}% 量比${s.volumeRatio?.toFixed(1)}，追高风险大` };
  if (up) return { label: "强势上行", color: "text-rose-300", desc: `今日+${s.pct.toFixed(1)}%，量能温和` };
  if (s.pct < -3) return { label: "明显回调", color: "text-emerald-300", desc: `今日${s.pct.toFixed(1)}%，趋势走弱` };
  if (hotTurnover) return { label: "高换手震荡", color: "text-amber-300", desc: `换手${s.turnoverRate?.toFixed(1)}%，筹码分歧` };
  return { label: "横盘整理", color: "text-slate-300", desc: `今日${fmtPct(s.pct)}，方向未明` };
}

/** 资金性质：主力/游资/散户（按委托金额口径近似，附局限性说明） */
function fundNature(s: WatchStock): { label: string; color: string; desc: string } {
  const mainPos = s.mainNet > 0;
  const extraDominant = s.extraLargeNet > 0 && Math.abs(s.extraLargeNet) > Math.abs(s.largeNet);
  const smallIn = s.smallNet > 0 && s.mainNet < 0;
  if (smallIn) return { label: "散户接盘", color: "text-emerald-300", desc: "主力流出+散户流入，警惕派发" };
  if (mainPos && extraDominant) return { label: "大资金进场", color: "text-rose-300", desc: `超大单主导，净流入${fmtMoney(s.mainNet)}` };
  if (mainPos) return { label: "主力净流入", color: "text-rose-300", desc: `净流入${fmtMoney(s.mainNet)}（占比${fmtPct(s.mainNetPct)}）` };
  return { label: "主力净流出", color: "text-slate-400", desc: `净流出${fmtMoney(s.mainNet)}` };
}

/** 主线归属：个股名是否命中今日主线龙头（核心/跟风），否则孤立 */
function mainlineOwn(s: WatchStock, mainlines: string[]): { label: string; color: string; desc: string } {
  if (!mainlines || mainlines.length === 0)
    return { label: "主线未知", color: "text-slate-500", desc: "今日无主线数据" };
  // 无法拿到个股概念归属时的近似：按名称是否出现在主线候选集内判断
  const hit = mainlines.find(m => s.name.includes(m) || m.includes(s.name));
  if (hit) return { label: `命中主线：${hit}`, color: "text-rose-300", desc: "与今日主线相关" };
  return { label: "不在今日主线", color: "text-slate-400", desc: "未命中今日主线候选" };
}

/** 止损/止盈参考（按近端波动近似，明确标注仅供参考） */
function stopRef(s: WatchStock): { stop: string; take: string } {
  const base = s.price > 0 ? s.price : 0;
  if (base <= 0) return { stop: "—", take: "—" };
  // 涨幅大的票给更宽止损，防止被正常波动扫掉
  const stopPct = s.pct >= 7 ? 8 : s.pct >= 3 ? 5 : 3;
  const takePct = s.pct >= 7 ? 5 : s.pct >= 3 ? 8 : 10;
  return {
    stop: base.toFixed(2) + `（-${stopPct}%）`,
    take: (base * (1 + takePct / 100)).toFixed(2) + `（+${takePct}%）`,
  };
}

// ============== 组件 ==============
export default function StockDecisionCard({ stock, vetoList, mainlines = [] }: Props) {
  const pos = techPosition(stock);
  const fund = fundNature(stock);
  const own = mainlineOwn(stock, mainlines);
  const vetoed = vetoList.length > 0;
  const ref = stopRef(stock);

  // 一句话结论（四色操作徽章，与主线口径一致）
  const conclusion = vetoed
    ? { label: "不建议参与", color: "bg-rose-500/20 text-rose-300 border-rose-500/40" }
    : pos.label === "高位放量"
      ? { label: "谨慎参与", color: "bg-amber-500/20 text-amber-300 border-amber-500/40" }
      : pos.label === "强势上行" && fund.label.includes("进场")
        ? { label: "可轻仓试错", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" }
        : { label: "观望", color: "bg-slate-500/20 text-slate-400 border-slate-500/40" };

  // 置信度：数据完整度近似（有否决=低置信，有量比/换手=高置信）
  const confidence = vetoed ? 40 : 65 + (stock.volumeRatio ? 10 : 0) + (stock.turnoverRate ? 5 : 0);

  const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-slate-500 shrink-0">{k}</span>
      <span className="text-right">{children}</span>
    </div>
  );

  return (
    <div className="rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-transparent p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-amber-300">🎯 个股决策卡</span>
        <span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${conclusion.color}`}>{conclusion.label}</span>
      </div>
      <div className="space-y-1.5">
        <Row k="主线归属">
          <span className={own.color}>{own.label}</span>
          <span className="ml-1 text-[10px] text-slate-500">{own.desc}</span>
        </Row>
        <Row k="技术位置">
          <span className={pos.color}>{pos.label}</span>
          <span className="ml-1 text-[10px] text-slate-500">{pos.desc}</span>
        </Row>
        <Row k="资金性质">
          <span className={fund.color}>{fund.label}</span>
          <span className="ml-1 text-[10px] text-slate-500">{fund.desc}</span>
        </Row>
        {vetoList.length > 0 && (
          <Row k="风险点">
            <span className="text-rose-300">
              {vetoList.slice(0, 2).map(v => v.reason).join("；")}
            </span>
          </Row>
        )}
        <Row k="止损/止盈参考">
          <span className="text-slate-300">损 {ref.stop} / 盈 {ref.take}（仅参考）</span>
        </Row>
        <Row k="置信度">
          <span className="text-violet-300">{confidence}%</span>
        </Row>
      </div>
      <div className="pt-1 border-t border-white/5 flex items-center justify-between">
        <span className="text-[10px] text-slate-600">规则引擎基于实时数据生成 · 资金按委托金额口径，无法识别拆单</span>
        <DisclaimerTag />
      </div>
    </div>
  );
}

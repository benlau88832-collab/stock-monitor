import { fmtMoney, fmtPct } from "../lib/format";
import type { WatchStock, VetoItem } from "./StockWatchlist";
import DisclaimerTag from "./DisclaimerTag";
import { checkStockExit, exitBadge } from "../lib/stockExit";
import { orderUrl } from "../lib/realLinks";
import { usePortfolio } from "../hooks/usePortfolio";
import AskAI from "./AskAI";
import DecisionActionPanel from "./DecisionActionPanel";

interface Props {
  stock: WatchStock;
  vetoList: VetoItem[];
  mainlines?: string[];
  cost?: number | null;
  classify?: { mainline?: string; concept?: string | null; source?: string } | null;
}

function techPosition(s: WatchStock) {
  const up = s.pct >= 7;
  const highVolume = (s.volumeRatio ?? 0) >= 2;
  const hotTurnover = (s.turnoverRate ?? 0) >= 10;
  if (up && highVolume) return { label: "高位放量", color: "text-rose-300", desc: `+${s.pct.toFixed(1)}% 量比${s.volumeRatio?.toFixed(1)}，追高风险大` };
  if (up) return { label: "强势上行", color: "text-rose-300", desc: `今日+${s.pct.toFixed(1)}%，量能温和` };
  if (s.pct < -3) return { label: "明显回调", color: "text-emerald-300", desc: `今日${s.pct.toFixed(1)}%，趋势走弱` };
  if (hotTurnover) return { label: "高换手震荡", color: "text-amber-300", desc: `换手${s.turnoverRate?.toFixed(1)}%，筹码分歧` };
  return { label: "横盘整理", color: "text-slate-300", desc: `今日${fmtPct(s.pct)}，方向未明` };
}

function fundNature(s: WatchStock) {
  const mainPos = s.mainNet > 0;
  const extraDominant = s.extraLargeNet > 0 && Math.abs(s.extraLargeNet) > Math.abs(s.largeNet);
  const smallIn = s.smallNet > 0 && s.mainNet < 0;
  if (smallIn) return { label: "散户接盘", color: "text-emerald-300", desc: "主力流出+散户流入，警惕派发" };
  if (mainPos && extraDominant) return { label: "大资金进场", color: "text-rose-300", desc: `超大单主导，净流入${fmtMoney(s.mainNet)}` };
  if (mainPos) return { label: "主力净流入", color: "text-rose-300", desc: `净流入${fmtMoney(s.mainNet)}（占比${fmtPct(s.mainNetPct)}）` };
  return { label: "主力净流出", color: "text-slate-400", desc: `净流出${fmtMoney(Math.abs(s.mainNet)).replace(/^\+/, "")}` };
}

function mainlineOwn(s: WatchStock, mainlines: string[], classify?: Props["classify"]) {
  if (!mainlines || mainlines.length === 0) return { label: "主线未知", color: "text-slate-500", desc: "今日无主线数据" };
  if (classify && classify.mainline && classify.mainline !== "其他") {
    const hit = mainlines.find((m) => m === classify.mainline || classify.mainline!.includes(m) || m.includes(classify.mainline!));
    if (hit) return { label: `命中主线：${hit}`, color: "text-rose-300", desc: `核心题材：${classify.concept ?? classify.mainline}（${classify.source}）` };
  }
  const hit2 = mainlines.find((m) => s.name.includes(m) || m.includes(s.name));
  if (hit2) return { label: `命中主线：${hit2}`, color: "text-rose-300", desc: "与今日主线相关" };
  return { label: "不在今日主线", color: "text-slate-400", desc: "未命中今日主线候选" };
}

function stopRef(s: WatchStock) {
  const base = s.price > 0 ? s.price : 0;
  if (base <= 0) return { stop: "-", take: "-" };
  const stopPct = s.pct >= 7 ? 8 : s.pct >= 3 ? 5 : 3;
  const takePct = s.pct >= 7 ? 5 : s.pct >= 3 ? 8 : 10;
  return { stop: base.toFixed(2) + `（${stopPct}%）`, take: (base * (1 + takePct / 100)).toFixed(2) + `（${takePct}%）` };
}

export default function StockDecisionCard({ stock, vetoList, mainlines = [], cost = null, classify = null }: Props) {
  const portfolio = usePortfolio();
  const pos = techPosition(stock);
  const fund = fundNature(stock);
  const own = mainlineOwn(stock, mainlines, classify);
  const vetoed = vetoList.length > 0;
  const ref = stopRef(stock);
  const exit = checkStockExit({
    code: stock.code, name: stock.name,
    cost, price: stock.price, pct: stock.pct,
    mainNetPct: stock.mainNetPct, retailNetPct: stock.smallNet > 0 ? 1 : 0,
    mainNet: stock.mainNet, mainNet5d: stock.mainNet5d, mainNet10d: stock.mainNet10d,
  });
  const exitB = exitBadge(exit);

  const strongAndFund = pos.label === "强势上行" && fund.label.includes("进场");
  const onMainline = own.label.startsWith("命中主线");
  const conclusion = vetoed
    ? { label: "不建议参与", color: "bg-rose-500/20 text-rose-300 border-rose-500/40" }
    : strongAndFund && onMainline
      ? { label: "重仓参与（主线核心）", color: "bg-rose-500/25 text-rose-200 border-rose-500/50" }
      : strongAndFund || (onMainline && pos.label !== "高位放量")
        ? { label: "轻仓参与", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" }
        : pos.label === "高位放量"
          ? { label: "谨慎参与", color: "bg-amber-500/20 text-amber-300 border-amber-500/40" }
          : { label: "观望", color: "bg-slate-500/20 text-slate-400 border-slate-500/40" };
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
        <span className="text-[11px] font-bold text-amber-300">个股决策卡</span>
        <span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${conclusion.color}`}>{conclusion.label}</span>
      </div>
      <div className="space-y-1.5">
        {exit.shouldExit && (
          <div className={`rounded border px-2 py-1.5 ${exit.level === "red" ? "border-rose-500/50 bg-rose-500/10" : "border-amber-500/40 bg-amber-500/10"}`}>
            <div className={`text-[11px] font-black ${exit.level === "red" ? "text-rose-300" : "text-amber-300"}`}>{exitB.label}</div>
            <div className="mt-0.5 text-[10px] text-slate-400 leading-relaxed">{exit.reasons.join("；")}</div>
          </div>
        )}
        <Row k="主线归属"><span className={own.color}>{own.label}</span><span className="ml-1 text-[10px] text-slate-500">{own.desc}</span></Row>
        <Row k="技术位置"><span className={pos.color}>{pos.label}</span><span className="ml-1 text-[10px] text-slate-500">{pos.desc}</span></Row>
        <Row k="资金性质"><span className={fund.color}>{fund.label}</span><span className="ml-1 text-[10px] text-slate-500">{fund.desc}</span></Row>
        {vetoList.length > 0 && <Row k="风险点"><span className="text-rose-300">{vetoList.slice(0, 2).map((v) => v.reason).join("；")}</span></Row>}
        <Row k="止损/止盈参考"><span className="text-slate-300">损 {ref.stop} / 盈 {ref.take}（仅供参考）</span></Row>
        <Row k="数据完整度"><span className="text-violet-300">{confidence}%</span></Row>
        <Row k="快速下单">
          <div className="flex gap-1">
            <a href={orderUrl(stock.code, "ths")} className="rounded px-1.5 py-0.5 text-[10px] bg-rose-500/20 text-rose-300 hover:bg-rose-500/30">同花顺</a>
            <a href={orderUrl(stock.code, "tdx")} className="rounded px-1.5 py-0.5 text-[10px] bg-sky-500/20 text-sky-300 hover:bg-sky-500/30">通达信</a>
            <a href={orderUrl(stock.code, "dfcf")} className="rounded px-1.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-300 hover:bg-amber-500/30">东财</a>
          </div>
        </Row>
        <DecisionActionPanel code={stock.code} name={stock.name} price={stock.price} defaultThesis={`${conclusion.label}：${own.label}；${fund.label}；${pos.label}`} confidenceAtPost={confidence} addTrade={portfolio.addTrade} saveLogic={portfolio.saveLogic} />
      </div>
      <AskAI
        code={stock.code}
        name={stock.name}
        compact
        context={`个股决策卡现场数据：${stock.name}(${stock.code}) 现价${stock.price.toFixed(2)} 今日${(stock.pct ?? 0).toFixed(1)}% 主力${fmtMoney(stock.mainNet)} 5日${fmtMoney(stock.mainNet5d)} 换手${(stock.turnoverRate ?? 0).toFixed(1)}% 量比${(stock.volumeRatio ?? 0).toFixed(1)} 概念归类：${classify?.concept ?? classify?.mainline ?? "未知"}`}
        placeholder="问：为什么跌？要不要加仓？资金在流出吗？"
      />
      <div className="pt-1 border-t border-white/5 flex items-center justify-between">
        <span className="text-[10px] text-slate-600">规则引擎基于实时数据生成 路 资金按委托金额口径，无法识别拆单 路 数据完整度为字段覆盖近似，非历史胜率</span>
        <DisclaimerTag />
      </div>
    </div>
  );
}

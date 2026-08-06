// ============================================================
// v9.35（S3）：信号历史回测引擎 —— 幻方"因子库验证"思想落地
// 幻方底层：200+ 因子经遗传算法动态筛选，只信"历史有效的因子"。
// 游资版翻译：盘中几十个信号，哪些真能预判次日？用历史数据验证。
// 数据源（本地服务端 kv）：
//   - sentiment:YYYY-MM-DD（情绪分，前端 cloudStore 已同步多日）
//   - market_daily:YYYY-MM-DD（涨停/跌停/炸板/最高板，cron 15:40 落库）
// 方法：对每个信号找"触发日"，统计次日情绪分变化 / 指标修复 → 样本数/胜率/方向
// ============================================================
import { isLocalServer } from "./cloudStore";
// v9.55（V7-19）：北京时间交易日历（周末+节假日统一判定，避免非东八区机器偏移）
import { isTradingDay, bjDateStr } from "./tradeCalendar";
// v9.62（V9-L1）：信号阈值统一引用 thresholds.ts
import { SENTI_EXTREME, SENTI_EXTREME_LOW, BLAST_RATE_HIGH, ZT_COUNT_HOT, ZT_COUNT_EUPHORIA, ZT_COUNT_REVIVE } from "./thresholds";

export interface SignalStat {
  id: string;
  name: string;          // 信号名
  condition: string;     // 触发条件
  samples: number;       // 历史触发次数
  winRate: number;       // 次日"正面结果"占比 %
  avgNextChange: number; // 次日情绪分平均变化
  verdict: "有效" | "存疑" | "样本不足";
  note: string;          // 结论一句话
}

interface DayRow {
  date: string;
  sentiment: number | null;
  ztCount: number | null;
  dtCount: number | null;
  blastedRate: number | null;
  maxBoardHeight: number | null;
}

/** 读取最近 N 个交易日的数据序列（v9.55 V7-19：按北京时间交易日历，节假日/时区不再偏移） */
async function loadHistory(days = 14): Promise<DayRow[]> {
  const out: DayRow[] = [];
  const d = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const t = new Date(d);
    t.setDate(t.getDate() - i);
    if (!isTradingDay(t)) continue; // 周末/节假日跳过
    const ds = bjDateStr(t);
    const row: DayRow = { date: ds, sentiment: null, ztCount: null, dtCount: null, blastedRate: null, maxBoardHeight: null };
    try {
      const r = await fetch(`/api/db/kv?key=${encodeURIComponent(`sentiment:${ds}`)}`);
      if (r.ok) {
        const v = await r.json();
        const num = Number(v?.value ?? NaN);
        if (Number.isFinite(num)) row.sentiment = num;
      }
    } catch { /* 静默 */ }
    try {
      const r = await fetch(`/api/db/kv?key=${encodeURIComponent(`market_daily:${ds}`)}`);
      if (r.ok) {
        const v = await r.json();
        const md = v?.value;
        if (md) {
          row.ztCount = md.ztCount ?? null;
          row.dtCount = md.dtCount ?? null;
          row.blastedRate = md.blastedRate ?? null;
          row.maxBoardHeight = md.maxBoardHeight ?? null;
        }
      }
    } catch { /* 静默 */ }
    out.push(row);
  }
  return out;
}

/** 信号定义：触发判定 + 正面结果判定（均基于"该日"与"次日"行） */
interface SignalDef {
  id: string;
  name: string;
  condition: string;
  /** 触发判定：r=当日, i=索引, rows=全序列（部分信号需看前一日） */
  trigger: (r: DayRow, i: number, rows: DayRow[]) => boolean;
  /** 正面结果判定：cur=触发日, next=次日 → 是否算"正" */
  positive: (cur: DayRow, next: DayRow) => boolean;
}

const SIGNALS: SignalDef[] = [
  // v9.62（V9-L1）：阈值统一引用 thresholds.ts
  {
    id: "senti_high", name: "情绪高位≥70",
    condition: "情绪分≥70（亢奋）",
    trigger: r => r.sentiment != null && r.sentiment >= SENTI_EXTREME,
    positive: (cur, n) => n.sentiment != null && n.sentiment >= cur.sentiment! - 10, // 次日不崩超10分
  },
  {
    id: "senti_low", name: "情绪冰点≤30",
    condition: "情绪分≤30（恐慌）",
    trigger: r => r.sentiment != null && r.sentiment <= SENTI_EXTREME_LOW,
    positive: (cur, n) => n.sentiment != null && n.sentiment > cur.sentiment!, // 次日回升
  },
  {
    id: "senti_down2", name: "情绪连续2日下",
    condition: "情绪分连续2日下跌",
    trigger: (r, i, rows) => i >= 1 && r.sentiment != null && rows[i - 1].sentiment != null
      && r.sentiment < rows[i - 1].sentiment!
      && rows[i - 1].sentiment! < (rows[i - 2]?.sentiment ?? 999),
    positive: (cur, n) => n.sentiment != null && n.sentiment >= cur.sentiment!, // 止跌
  },
  {
    id: "blast_high", name: "炸板率≥35%",
    condition: "炸板率≥35%（封不住）",
    trigger: r => r.blastedRate != null && r.blastedRate >= BLAST_RATE_HIGH,
    positive: (_cur, n) => n.blastedRate != null && n.blastedRate < BLAST_RATE_HIGH, // 次日炸板回落
  },
  {
    id: "zt_many", name: "涨停≥50只",
    condition: "涨停数≥50（普涨）",
    trigger: r => r.ztCount != null && r.ztCount >= ZT_COUNT_HOT,
    positive: (_cur, n) => n.ztCount != null && n.ztCount >= ZT_COUNT_EUPHORIA, // 次日维持活跃
  },
  {
    id: "zt_few", name: "涨停≤15只",
    condition: "涨停数≤15（冰点）",
    trigger: r => r.ztCount != null && r.ztCount <= ZT_COUNT_REVIVE,
    positive: (_cur, n) => n.ztCount != null && n.ztCount > ZT_COUNT_REVIVE, // 次日修复
  },
  {
    id: "height_6", name: "最高板≥6",
    condition: "最高连板≥6（高度强）",
    trigger: r => r.maxBoardHeight != null && r.maxBoardHeight >= 6,
    positive: (_cur, n) => n.maxBoardHeight != null && n.maxBoardHeight >= 4, // 高度不崩
  },
];

/**
 * 信号回测主入口：本地部署时读取历史数据，计算每个信号的历史表现。
 * 返回 null = 非本地部署或有效数据日不足。
 */
export async function backtestSignals(days = 14): Promise<SignalStat[] | null> {
  if (!isLocalServer()) return null;
  const rows = await loadHistory(days);
  const valid = rows.filter(r => r.sentiment != null);
  if (valid.length < 4) return null;

  const stats: SignalStat[] = [];
  for (const sig of SIGNALS) {
    let samples = 0, positives = 0;
    let sumNextChange = 0, cntNext = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      const cur = rows[i];
      const next = rows[i + 1];
      if (!sig.trigger(cur, i, rows)) continue;
      samples++;
      if (cur.sentiment != null && next.sentiment != null) {
        sumNextChange += next.sentiment - cur.sentiment;
        cntNext++;
        if (sig.positive(cur, next)) positives++;
      }
    }
    const winRate = samples > 0 ? Math.round(positives / samples * 100) : 0;
    const avgNextChange = cntNext > 0 ? Math.round(sumNextChange / cntNext * 10) / 10 : 0;
    let verdict: SignalStat["verdict"] = "样本不足";
    if (samples >= 6) {
      if (winRate >= 60) verdict = "有效";
      else if (winRate >= 45) verdict = "存疑";
      else verdict = "存疑";
    }
    const note =
      verdict === "有效" ? `历史${samples}次，次日正面率${winRate}%${avgNextChange >= 0 ? "，情绪均+" : "，情绪均"}${Math.abs(avgNextChange).toFixed(1)}分` :
      verdict === "样本不足" ? `仅${samples}次样本，每日自动积累中` :
      `历史${samples}次正面率${winRate}%，该信号谨慎使用`;
    stats.push({
      id: sig.id, name: sig.name, condition: sig.condition,
      samples, winRate, avgNextChange, verdict, note,
    });
  }
  return stats.sort((a, b) => b.samples - a.samples);
}

import { useState, useCallback } from "react";
import { fmtMoney, fmtPct } from "../lib/format";
import type { OverviewData, FundStructureData } from "../App";
import type { LimitPoolSummary } from "../lib/api";

const LLM_BASE_URL = "https://apihub.agnes-ai.com/v1";
const LLM_MODEL = "agnes-2.5-flash";
const HISTORY_KEY = "daily_summary_history";
const APIKEY_STORAGE = "llm_api_key";

interface SummaryRecord { date: string; content: string; timestamp: number }

function loadHistory(): SummaryRecord[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
}
function saveHistory(records: SummaryRecord[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(records.slice(0, 10)));
}

function buildSummaryPrompt(overview: OverviewData | null, fund: FundStructureData | null, limitPool: LimitPoolSummary | null): string {
  const parts: string[] = [];
  if (overview?.breadth) {
    const b = overview.breadth;
    parts.push(`【市场概况】全市场${b.total}只，上涨${b.up}只，下跌${b.down}只，平盘${b.flat}只，平均涨跌幅${fmtPct(b.avgPct)}，情绪温度计${overview.sentiment}分（${overview.sentimentLabel}）`);
  }
  if (fund?.structure) {
    const s = fund.structure;
    parts.push(`【资金结构】今日主力净流入${fmtMoney(s.today.mainNet)}，超大单${fmtMoney(s.today.extraLargeNet)}，大单${fmtMoney(s.today.largeNet)}，中单${fmtMoney(s.today.mediumNet)}，小单${fmtMoney(s.today.smallNet)}，近5日主力${fmtMoney(s.mainNet5d)}，近10日主力${fmtMoney(s.mainNet10d)}`);
  }
  if (limitPool) {
    const boards = Object.entries(limitPool.boardCounts).sort(([a], [b]) => Number(b) - Number(a)).map(([k, v]) => `${k}板${v}只`).join("，");
    parts.push(`【涨停复盘】涨停${limitPool.limitUpCount}只，跌停${limitPool.limitDownCount}只，炸板${limitPool.blastedCount}只（炸板率${limitPool.blastedRate.toFixed(1)}%），连板分布：${boards || "无"}`);
  }
  if (overview?.indices?.length) {
    parts.push(`【指数表现】${overview.indices.map(i => `${i.name}${fmtPct(i.pct)}`).join("，")}`);
  }

  return `你是专业的A股盘后复盘分析师。请根据以下今日全市场数据，生成一段结构化的复盘总结（400字以内）。

${parts.join("\n")}

【严格要求】必须引用上述具体数值作为论据，禁止模糊表述。

请严格按以下五段结构输出：
1.【市场情绪】定性描述今日情绪级别（极度恐慌/恐慌/中性/贪婪/极度贪婪），引用温度计分值和涨跌家数
2.【主线题材】今日最强主线题材方向，引用涨停板连板梯队数据
3.【资金解读】主力资金真实流向（区分真流入vs对倒），引用超大单/大单/中单/小单具体数字
4.【次日关注】明日重点关注方向和可能的操作策略建议
5.【风险提示】当前市场主要风险点`;
}

export default function DailySummary({ overview, fund }: {
  overview: OverviewData | null; fund: FundStructureData | null;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<SummaryRecord[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);

  const apiKey = localStorage.getItem(APIKEY_STORAGE) || "";

  const generate = useCallback(async () => {
    if (!apiKey) { setContent("❌ 请先在「个股雷达」Tab 配置 API Key"); return; }
    setLoading(true); setContent(null);
    try {
      const prompt = buildSummaryPrompt(overview, fund, overview?.limitPool ?? null);
      const resp = await fetch(`${LLM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: LLM_MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 800, temperature: 0.3 }),
      });
      const json = await resp.json();
      if (json.error) throw new Error(json.error.message);
      const result = json.choices?.[0]?.message?.content || "未返回内容";
      setContent(result);
      // 保存历史
      const today = new Date().toISOString().slice(0, 10);
      const newHistory = [{ date: today, content: result, timestamp: Date.now() }, ...history.filter(h => h.date !== today)].slice(0, 10);
      setHistory(newHistory);
      saveHistory(newHistory);
    } catch (err) {
      setContent(`❌ ${err instanceof Error ? err.message : String(err)}`);
    } finally { setLoading(false); }
  }, [apiKey, overview, fund, history]);

  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-violet-300">🤖 今日复盘总结（AI生成）</div>
        <div className="flex gap-2">
          {history.length > 0 && (
            <button onClick={() => setShowHistory(v => !v)}
              className="rounded px-2 py-1 text-[11px] bg-white/10 text-slate-300 hover:bg-white/20">
              {showHistory ? "收起历史" : `历史(${history.length})`}
            </button>
          )}
          <button onClick={generate} disabled={loading}
            className="rounded px-3 py-1 text-xs bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 disabled:opacity-40">
            {loading ? "生成中…" : "📝 生成复盘"}
          </button>
        </div>
      </div>

      {content && (
        <div className="text-xs text-violet-200 whitespace-pre-wrap leading-relaxed">{content}</div>
      )}

      {!content && !loading && (
        <div className="text-xs text-slate-500">点击"生成复盘"按钮，AI将综合情绪温度计、资金结构、涨停复盘等数据生成今日复盘总结。</div>
      )}

      {showHistory && history.length > 0 && (
        <div className="border-t border-violet-500/20 pt-2 space-y-2 max-h-60 overflow-y-auto">
          <div className="text-[11px] text-violet-400">历史复盘记录</div>
          {history.map(h => (
            <div key={h.timestamp} className="rounded bg-black/20 p-2">
              <div className="text-[11px] text-violet-400/60 mb-1">{h.date}</div>
              <div className="text-[11px] text-violet-200/80 whitespace-pre-wrap leading-relaxed">{h.content}</div>
            </div>
          ))}
        </div>
      )}

      <div className="text-[11px] text-violet-400/50">⚠️ AI 复盘总结仅供参考，不构成投资建议。数据来自当日实时接口。</div>
    </div>
  );
}

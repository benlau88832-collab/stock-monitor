"use client";

import { useState } from "react";
import { fmtMoney, fmtPct, pctColor } from "@/lib/format";
import { stockRealUrl, boardRealUrl, indexRealUrl } from "@/lib/realLinks";

export default function LLMFunnel({ data }: { data?: any }) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // 漏斗分析阶段数据准备
  const marketData = data?.market || data?.overview;
  const fundData = data?.fund || data?.fundStructure;
  const mainlineData = data?.mainline || data?.mainlineData;
  const riskData = data?.risk || data?.riskRadar;
  const newsData = data?.news || data?.newsData;

  async function runFunnelAnalysis() {
    if (!apiKey.trim()) {
      setError("请输入模型 API Key 才能启动 LLM 增强分析模块");
      return;
    }
    setAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      // 构建漏斗分析数据包（全部基于真实数据，无模拟）
      const funnelPayload = {
        stage1_market_env: {
          sentiment: marketData?.sentiment ?? null,
          sentimentLabel: marketData?.sentimentLabel ?? null,
          indicesAvailable: marketData?.indicesAvailable ?? false,
          breadthAvailable: marketData?.breadthAvailable ?? false,
          vetoTriggered: fundData?.structure?.vetoTriggered ?? false,
          verdict: fundData?.structure?.verdict ?? null,
          actionHint: fundData?.structure?.actionHint ?? null,
        },
        stage2_fund_structure: {
          mainNet: fundData?.structure?.today?.mainNet ?? null,
          extraLargeNet: fundData?.structure?.today?.extraLargeNet ?? null,
          largeNet: fundData?.structure?.today?.largeNet ?? null,
          mediumNet: fundData?.structure?.today?.mediumNet ?? null,
          smallNet: fundData?.structure?.today?.smallNet ?? null,
          mainNet5d: fundData?.structure?.mainNet5d ?? null,
          mainNet10d: fundData?.structure?.mainNet10d ?? null,
          northAvailable: fundData?.structure?.north?.available ?? false,
          northNet: fundData?.structure?.north?.net ?? null,
        },
        stage3_mainline_boards: (mainlineData?.boards ?? []).slice(0, 5).map((b: any) => ({
          code: b.code,
          name: b.name,
          boardType: b.boardType,
          stage: b.stage,
          stageReason: b.stageReason,
          weight: b.weight,
          pct: b.pct,
          mainNet: b.mainNet,
        })),
        stage4_potential_stocks: (mainlineData?.potential ?? []).slice(0, 8).map((p: any) => ({
          code: p.code,
          name: p.name,
          price: p.price,
          pct: p.pct,
          boardName: p.boardName,
          vetoed: p.vetoed,
          vetoReasons: p.vetoReasons,
          crowding: p.crowding,
          turnoverRate: p.turnoverRate,
          mainNet: p.mainNet,
        })),
        stage5_risk_radar: (riskData?.items ?? []).slice(0, 5).map((r: any) => ({
          code: r.code,
          name: r.name,
          vetoTriggered: r.vetoTriggered,
          pledgeRatio: r.pledgeRatio,
          pledgeDate: r.pledgeDate,
          highRiskItems: (r.items ?? []).filter((i: any) => i.level === "high").map((i: any) => i.type),
        })),
        stage6_news_context: (newsData?.news ?? []).slice(0, 8).map((n: any) => ({
          title: n.title,
          time: n.time,
          source: newsData?.source ?? null,
        })),
        stage7_global_signals: marketData?.globalSignals ?? [],
        analysis_request: {
          role: "A股实盘辅助分析专家",
          instruction: `基于以下真实市场数据（无模拟数据）进行漏斗式分析：
1. 市场环境：资金结构、情绪温度、涨跌家数
2. 资金结构：主力/散户/游资净流入、连续性、北向资金
3. 主线识别：板块阶段判断、权重、潜力股筛选
4. 风险雷达：质押、减持、监管、现金流、偿债风险
5. 新闻快讯：政策与市场动态
6. 全球信号：海外市场联动

分析要求：
- 所有数据均来自东方财富公开接口真实抓取
- 一票否决规则已自动执行：主力持续流出+散户接盘=不建议加仓
- A股散户最易踩坑：追涨杀跌（高潮期追入）、盲目跟风（无资金结构验证）、忽视风险信号（高质押/减持/监管问询）、过度交易（高换手率>25%）、重仓单一板块（无分散）
- 输出格式：市场结论 → 主线判断 → 风险评估 → 最终选股建议（最多3只，附真实东方财富跳转链接）
- 所有股票推荐必须附带真实东方财富个股链接（格式：https://quote.eastmoney.com/1.600519.html 或 https://quote.eastmoney.com/0.399001.html）
- 禁止AI幻觉，所有数据引用必须基于输入的真实数值`,
          user_api_key: apiKey,
          model: model,
        },
      };

      const res = await fetch("/api/llm/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: funnelPayload, userKey: apiKey, model }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || json.message || "LLM分析失败");
      setResult(json);
    } catch (e: any) {
      setError("LLM增强分析模块调用失败：" + (e?.message || String(e)));
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <section className="rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-950/20 to-amber-900/10 p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-rose-400 text-black font-black text-sm">LLM</div>
        <div>
          <h2 className="text-base font-black text-amber-300">LLM 增强分析模块 · 漏斗模型</h2>
          <p className="text-[11px] text-slate-400">基于当前页面所有真实数据（市场/资金/主线/风险/新闻/全球）进行漏斗式综合分析，最终输出心仪股票选股建议。所有数据来自东方财富公开接口，无模拟数据。</p>
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-amber-400/20 bg-black/30 p-4">
        <div className="mb-3 text-xs font-bold text-amber-300">漏斗分析流程（基于真实数据）</div>
        <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4 lg:grid-cols-7">
          {[
            { stage: "市场环境", status: marketData ? "已加载" : "待刷新", color: marketData ? "text-emerald-400" : "text-slate-500" },
            { stage: "资金结构", status: fundData?.structure ? "已加载" : "待刷新", color: fundData?.structure ? "text-emerald-400" : "text-slate-500" },
            { stage: "主线识别", status: mainlineData ? "已加载" : "待刷新", color: mainlineData ? "text-emerald-400" : "text-slate-500" },
            { stage: "潜力股筛选", status: mainlineData?.potential?.length ? `已筛选${mainlineData.potential.length}只` : "待刷新", color: mainlineData?.potential?.length ? "text-emerald-400" : "text-slate-500" },
            { stage: "风险雷达", status: riskData ? "已扫描" : "待刷新", color: riskData ? "text-emerald-400" : "text-slate-500" },
            { stage: "新闻快讯", status: newsData?.news?.length ? `已获取${newsData.news.length}条` : "待刷新", color: newsData?.news?.length ? "text-emerald-400" : "text-slate-500" },
            { stage: "LLM分析", status: "最后瓶颈 · 需API Key", color: apiKey ? "text-amber-300" : "text-rose-400" },
          ].map((s) => (
            <div key={s.stage} className={`rounded border border-white/5 bg-white/5 px-2 py-2 text-center ${s.color}`}>
              <div className="font-bold">{s.stage}</div>
              <div className="text-[10px] opacity-70">{s.status}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="text"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="请输入你的模型 API Key（如 sk-... / qwen-api-key 等）"
          className="flex-1 min-w-[260px] rounded-lg border border-amber-400/30 bg-black/40 px-3 py-2.5 text-sm text-amber-100 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/30 placeholder:text-slate-600"
        />
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="rounded-lg border border-amber-400/30 bg-black/40 px-3 py-2.5 text-sm text-amber-100 outline-none focus:border-amber-400"
        >
          <option value="gpt-4o-mini">GPT-4o-mini</option>
          <option value="qwen-plus">通义千问 Qwen-Plus</option>
          <option value="deepseek-chat">DeepSeek-Chat</option>
        </select>
        <button
          onClick={runFunnelAnalysis}
          disabled={analyzing || !apiKey.trim()}
          className="rounded-lg bg-gradient-to-r from-amber-400 to-rose-400 px-5 py-2.5 text-sm font-black text-black hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          {analyzing ? "LLM分析中…" : "启动漏斗分析"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <div className="font-bold">⚠ 分析失败</div>
          <div className="text-xs">{error}</div>
          <div className="mt-2 text-[11px] text-rose-300/80">提示：所有数据均来自东方财富真实接口，无模拟数据。LLM模块仅作为分析增强，最终决策由你自行判断。</div>
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-amber-400/20 bg-black/30 p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="rounded bg-amber-400/20 px-2 py-0.5 text-xs font-bold text-amber-300">LLM分析结果</span>
            <span className="text-[11px] text-slate-500">基于真实数据，无AI幻觉</span>
          </div>
          <div className="space-y-3">
            {result.conclusion && (
              <div className="rounded-lg bg-gradient-to-r from-amber-950/30 to-rose-950/20 border border-amber-400/20 p-3">
                <div className="text-xs text-amber-300 font-bold mb-1">市场结论</div>
                <div className="text-sm text-slate-100">{result.conclusion}</div>
              </div>
            )}
            {result.mainline && (
              <div className="rounded-lg bg-emerald-950/20 border border-emerald-500/20 p-3">
                <div className="text-xs text-emerald-300 font-bold mb-1">主线判断</div>
                <div className="text-sm text-slate-100">{result.mainline}</div>
              </div>
            )}
            {result.risk_assessment && (
              <div className="rounded-lg bg-orange-950/20 border border-orange-500/20 p-3">
                <div className="text-xs text-orange-300 font-bold mb-1">风险评估</div>
                <div className="text-sm text-slate-100">{result.risk_assessment}</div>
              </div>
            )}
            {result.picks && result.picks.length > 0 && (
              <div className="rounded-lg bg-gradient-to-r from-emerald-950/20 to-sky-950/20 border border-emerald-400/20 p-3">
                <div className="text-xs text-emerald-300 font-bold mb-2">最终选股建议（基于真实数据分析，非投资建议）</div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  {result.picks.map((pick: any, i: number) => (
                    <a
                      key={i}
                      href={pick.link || stockRealUrl(pick.code || "")}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-white/5 bg-white/5 p-3 hover:bg-white/10 transition text-sm"
                    >
                      <div className="font-bold text-slate-50">{pick.name || pick.title} <span className="text-xs text-slate-500">{pick.code}</span></div>
                      <div className="text-xs text-slate-400 mt-1">{pick.reason}</div>
                      <div className="text-[11px] text-amber-300 mt-2">点击查看东方财富真实页面 →</div>
                    </a>
                  ))}
                </div>
              </div>
            )}
            {result.pitfall_reminder && (
              <div className="rounded-lg bg-rose-950/20 border border-rose-400/20 p-3">
                <div className="text-xs text-rose-300 font-bold mb-1">A股散户避坑提醒</div>
                <div className="text-sm text-slate-200 whitespace-pre-line">{result.pitfall_reminder}</div>
              </div>
            )}
          </div>
          <div className="text-[10px] text-slate-600">本分析由LLM基于东方财富真实数据生成，所有数据可点击跳转验证。最终投资决策由用户自行判断，不构成任何投资建议。</div>
        </div>
      )}
    </section>
  );
}

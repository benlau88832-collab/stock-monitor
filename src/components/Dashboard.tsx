"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TopNav, { TabKey } from "./TopNav";
import MarketOverview from "./MarketOverview";
import FundStructure from "./FundStructure";
import RiskRadar from "./RiskRadar";
import Mainline from "./Mainline";
import StockMonitor from "./StockMonitor";
import NewsPanel from "./NewsPanel";
import Settings from "./Settings";
import LLMFunnel from "./LLMFunnel";
import Pitfalls from "./Pitfalls";
import DarkPool from "./DarkPool";
import GlobalSignals from "./GlobalSignals";
import KeyIndicators from "./KeyIndicators";

async function safeJson(url: string) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return await res.json();
  } catch (e: any) {
    return { message: e?.message || "网络请求失败" };
  }
}

export default function Dashboard() {
  const [active, setActive] = useState<TabKey>("market");
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [overview, setOverview] = useState<any>(null);
  const [fundStructure, setFundStructure] = useState<any>(null);
  const [riskRadar, setRiskRadar] = useState<any>(null);
  const [mainline, setMainline] = useState<any>(null);
  const [news, setNews] = useState<any>(null);
  const [llmKey, setLLMKey] = useState("");
  const [darkPool, setDarkPool] = useState<any>(null);

  const inFlight = useRef(false);

  const refreshAll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const [ov, fs, rr, ml, nw, dp] = await Promise.all([
        safeJson("/api/market/overview"),
        safeJson("/api/market/fund-structure"),
        safeJson("/api/market/risk-radar"),
        safeJson("/api/market/mainline"),
        safeJson("/api/news"),
        safeJson("/api/market/dark-pool"),
      ]);
      setOverview(ov);
      setFundStructure(fs);
      setRiskRadar(rr);
      setMainline(ml);
      setNews(nw);
      setDarkPool(dp);
      setLastUpdated(new Date().toISOString());
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(refreshAll, 15000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshAll]);

  const vetoActive = fundStructure?.structure?.vetoTriggered;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#0d1424,_#05070d_60%)] pb-16">
      <TopNav
        active={active}
        onChange={setActive}
        lastUpdated={lastUpdated}
        loading={loading}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
        onRefreshNow={refreshAll}
      />

      {vetoActive && (
        <div className="border-b border-rose-500/40 bg-rose-600/20 px-4 py-2 text-center text-sm font-bold text-rose-200">
          🚨 一票否决警报：当前市场资金结构呈现「主力持续流出 + 散户接盘」，不建议加仓，详见「资金结构」模块
        </div>
      )}

      <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6">
        {active === "market" && (
          <>
            <MarketOverview data={overview} loading={loading} />
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <h3 className="mb-3 text-sm font-bold text-slate-200">资金结构速览</h3>
              <FundStructure data={fundStructure} loading={loading} />
            </div>
            <DarkPool data={darkPool} loading={loading} />
            <GlobalSignals data={{ globalSignals: [] }} />
            <KeyIndicators data={{ indicators: [] }} />
          </>
        )}
        {active === "fund" && <FundStructure data={fundStructure} loading={loading} />}
        {active === "risk" && <RiskRadar data={riskRadar} loading={loading} />}
        {active === "mainline" && <Mainline data={mainline} loading={loading} />}
        {active === "stock" && <StockMonitor />}
        {active === "news" && <NewsPanel data={news} loading={loading} />}
        {active === "settings" && <Settings />}
        {active === "llm" && <LLMFunnel data={{ overview, fundStructure, mainline, riskRadar, news, marketData: overview }} />}
        {active === "pitfalls" && <Pitfalls />}
      </main>

      <footer className="mx-auto max-w-[1500px] px-4 text-center text-[11px] text-slate-600">
        本终端仅用于实盘交易辅助监控，所有数据来自公开接口实时抓取，不构成投资建议 · 资金结构 &gt; 涨跌幅 · 风险信号 &gt; 机会信号 · 阶段判断 &gt; 单一指标
      </footer>
    </div>
  );
}

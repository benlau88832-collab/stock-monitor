import { useState, useEffect, useCallback, useRef } from "react";
import { fetchStockOne, fetchStockNews, fetchStockAnnouncements, fetchLiftBan, stockLimitPct, type StockNewsItem, type StockAnnouncement } from "../lib/api";
import { fmtMoney, fmtPct, pctColor } from "../lib/format";
import { stockRealUrl } from "../lib/realLinks";

// ============== LLM 配置 ==============
const LLM_BASE_URL = "https://apihub.agnes-ai.com/v1";
const LLM_MODEL = "agnes-2.5-flash";

// ============== 数据结构 ==============
interface WatchStock {
  code: string; name: string; price: number; pct: number;
  mainNet: number; mainNetPct: number;
  extraLargeNet: number; largeNet: number; mediumNet: number; smallNet: number;
  mainNet5d: number; mainNet10d: number;
  turnoverRate: number; pe: number; volumeRatio: number;
  alertCount: number; // 异动信号数
  healthScore: number | null; // AI健康度评分(1-100)
  healthTip: string; // 一句话提示
}

interface InfoItem {
  type: "news" | "announcement" | "fund";
  title: string; summary: string; time: string; url: string;
  tag: string; tagColor: string;
}

interface ChatMsg { role: "user" | "assistant"; content: string }

const STORAGE_KEY = "stock_watchlist";
const APIKEY_STORAGE = "llm_api_key";

function loadWatchlist(): string[] {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : ["600519", "000001", "300750"]; }
  catch { return ["600519", "000001", "300750"]; }
}
function saveWatchlist(codes: string[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(codes)); }

// 计算异动信号数
function countAlerts(s: WatchStock): number {
  let count = 0;
  if (s.mainNet < 0 && s.smallNet > 0) count++; // 主力出散户进
  if (Math.abs(s.pct) >= stockLimitPct(s.code) - 0.2) count++; // 涨跌停
  if (s.volumeRatio > 2.5) count++; // 量比异常
  if (s.turnoverRate > 15) count++; // 换手率过高
  if (s.mainNet5d < 0 && s.mainNet10d < 0 && s.mainNet < 0) count++; // 持续流出
  return count;
}

// ============== 否决条件引擎 ==============
interface VetoItem { reason: string; color: string }

const VETO_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  // 股东减持
  { re: /减持.{0,4}(计划|进展|完成|公告|预披露)/i, reason: "重要股东减持" },
  // 监管风险
  { re: /立案|行政处罚|警示函|问询函|责令改正|监管措施/i, reason: "监管风险" },
  // 业绩雷
  { re: /预亏|业绩亏损|商誉减值|大额计提|业绩预减/i, reason: "业绩雷" },
];

function buildVetoList(stock: WatchStock, newsTitles: string[], annTitles: string[], liftBanDays: number | null): VetoItem[] {
  const vetos: VetoItem[] = [];
  // 原有三条保留
  if (stock.mainNet < 0 && stock.smallNet > 0) {
    vetos.push({ reason: "主力流出+散户流入", color: "bg-rose-500/20 text-rose-300" });
  }
  if (Math.abs(stock.pct) >= stockLimitPct(stock.code) - 0.2) {
    vetos.push({ reason: stock.pct > 0 ? "已涨停" : "已跌停", color: "bg-amber-500/20 text-amber-300" });
  }
  if (stock.turnoverRate > 25) {
    vetos.push({ reason: `换手率${stock.turnoverRate.toFixed(1)}%>25%`, color: "bg-amber-500/20 text-amber-300" });
  }
  // 新增：ST/退市风险
  if (/ST|退市|退/.test(stock.name)) {
    vetos.push({ reason: "风险警示/退市风险", color: "bg-red-500/20 text-red-300" });
  }
  // 新增：公告/新闻关键词扫描
  const allTitles = [...newsTitles, ...annTitles];
  for (const { re, reason } of VETO_PATTERNS) {
    if (allTitles.some(t => re.test(t))) {
      vetos.push({ reason, color: "bg-rose-500/20 text-rose-300" });
    }
  }
  // 新增：近30天内解禁
  if (liftBanDays != null && liftBanDays >= 0 && liftBanDays <= 30) {
    vetos.push({ reason: `${liftBanDays}天内有解禁`, color: "bg-amber-500/20 text-amber-300" });
  }
  return vetos;
}

// ============== 新闻/公告5分钟内存缓存 ==============
const infoCache = new Map<string, { data: { news: StockNewsItem[]; anns: StockAnnouncement[] }; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5分钟

async function fetchInfoCached(code: string, name: string): Promise<{ news: StockNewsItem[]; anns: StockAnnouncement[] }> {
  const cached = infoCache.get(code);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  const [newsRes, annRes] = await Promise.allSettled([
    fetchStockNews(name || code, 8),
    fetchStockAnnouncements(code, 8),
  ]);
  const data = {
    news: newsRes.status === "fulfilled" ? newsRes.value : [],
    anns: annRes.status === "fulfilled" ? annRes.value : [],
  };
  infoCache.set(code, { data, ts: Date.now() });
  return data;
}

// ============== 解禁缓存（同样5分钟） ==============
const liftBanCache = new Map<string, { days: number | null; ts: number }>();

async function fetchLiftBanDays(code: string): Promise<number | null> {
  const cached = liftBanCache.get(code);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.days;
  try {
    const items = await fetchLiftBan(code);
    const now = Date.now();
    // 找未来最近的解禁日
    let minDays: number | null = null;
    for (const item of items) {
      const freeTs = new Date(item.freeDate).getTime();
      const diffDays = Math.ceil((freeTs - now) / 86400000);
      if (diffDays >= 0 && (minDays == null || diffDays < minDays)) minDays = diffDays;
    }
    liftBanCache.set(code, { days: minDays, ts: now });
    return minDays;
  } catch {
    // 解禁接口探测失败时跳过本项（注释：RPT_LIFT_STAGE 已验证可用，此处为网络容错）
    liftBanCache.set(code, { days: null, ts: Date.now() });
    return null;
  }
}

// ============== 详细研判 Prompt（六段式） ==============
function buildDetailPrompt(stock: WatchStock, newsContext: string): string {
  return `你是专业的A股短线交易分析师。请对以下个股进行严谨的六段式研判。

【严格要求】
- 每一段必须引用具体数值作为论据，禁止"资金流出较多""量能一般"等不带数字的模糊表述
- 对判断要给出概率化或历史统计描述，如果没有精确统计数据，必须明确说明"此为经验定性判断，非精确统计"
- 总字数控制在350字以内

【${stock.name}(${stock.code})实时数据】
现价：${stock.price}元 | 涨跌幅：${fmtPct(stock.pct)}
今日主力净流入：${fmtMoney(stock.mainNet)}（占比${fmtPct(stock.mainNetPct)}）
近5日主力累计：${fmtMoney(stock.mainNet5d)} | 近10日主力累计：${fmtMoney(stock.mainNet10d)}
超大单：${fmtMoney(stock.extraLargeNet)} | 大单：${fmtMoney(stock.largeNet)}
中单：${fmtMoney(stock.mediumNet)} | 小单：${fmtMoney(stock.smallNet)}
换手率：${stock.turnoverRate}% | 量比：${stock.volumeRatio} | PE(TTM)：${stock.pe}

近期消息：
${newsContext || "无最新消息"}

请严格按以下六段结构输出：
1.【资金面】引用具体主力净额、5日/10日趋势数字，判断资金结构健康度
2.【消息面】结合上述消息，判断利好/利空/中性，说明可能影响
3.【技术面】结合量比${stock.volumeRatio}和换手率${stock.turnoverRate}%等数字，判断量价关系
4.【同类股对比】提及该股所属板块中1-2只代表性股票，判断该股是领涨、跟涨还是滞涨
5.【操作建议】给出明确的短线操作建议（加仓/持有/减仓/回避），附加仓位建议
6.【风险等级】一句话总结风险等级（低/中/高），并说明主要风险点`;
}

// ============== 批量扫描 Prompt ==============
function buildScanPrompt(stock: WatchStock): string {
  return `你是A股分析师。请对以下个股只输出两行，不要多说：
第一行：健康度评分（1-100整数，1=极度危险，100=极度健康）
第二行：一句话风险提示（20字以内）

数据：${stock.name}(${stock.code}) 现价${stock.price} ${fmtPct(stock.pct)} 主力净流入${fmtMoney(stock.mainNet)}(${fmtPct(stock.mainNetPct)}) 5日${fmtMoney(stock.mainNet5d)} 10日${fmtMoney(stock.mainNet10d)} 换手${stock.turnoverRate}% 量比${stock.volumeRatio}

只输出两行，格式示例：
65
主力持续流出，短线承压`;
}

// ============== LLM 调用 ==============
async function callLLM(apiKey: string, messages: ChatMsg[], maxTokens = 600): Promise<string> {
  const resp = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: LLM_MODEL, messages, max_tokens: maxTokens, temperature: 0.3 }),
  });
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.choices?.[0]?.message?.content || "未返回内容";
}

// ============== 健康度颜色 ==============
function healthColor(score: number | null): string {
  if (score == null) return "bg-slate-500/20 text-slate-400";
  if (score >= 70) return "bg-emerald-500/20 text-emerald-300";
  if (score >= 40) return "bg-amber-500/20 text-amber-300";
  return "bg-rose-500/20 text-rose-300";
}

// ============== 主组件 ==============
export default function StockWatchlist() {
  const [codes, setCodes] = useState<string[]>(loadWatchlist);
  const [stocks, setStocks] = useState<Record<string, WatchStock>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [infoItems, setInfoItems] = useState<InfoItem[]>([]);
  const [infoLoading, setInfoLoading] = useState(false);
  const [vetoList, setVetoList] = useState<VetoItem[]>([]);
  const [inputCode, setInputCode] = useState("");
  const [sortByAlert, setSortByAlert] = useState(false);

  // AI 状态
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(APIKEY_STORAGE) || "");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [llmResult, setLlmResult] = useState<string | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  // 追问
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [followUp, setFollowUp] = useState("");
  const [followUpLoading, setFollowUpLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // ---- 加载所有监控股行情 ----
  const refreshStocks = useCallback(async () => {
    const results: Record<string, WatchStock> = {};
    for (const code of codes) {
      try {
        const data = await fetchStockOne(code);
        if (data) {
          const s: WatchStock = { ...data, alertCount: 0, healthScore: null, healthTip: "" };
          s.alertCount = countAlerts(s);
          // 保留已有的健康度评分
          const prev = stocks[code];
          if (prev) { s.healthScore = prev.healthScore; s.healthTip = prev.healthTip; }
          results[code] = s;
        }
      } catch { /* skip */ }
    }
    setStocks(results);
    if (!selected && codes.length > 0) setSelected(codes[0]);
  }, [codes, selected, stocks]);

  useEffect(() => { refreshStocks(); }, [codes]); // eslint-disable-line
  useEffect(() => { const t = setInterval(refreshStocks, 60000); return () => clearInterval(t); }, [refreshStocks]);

  // ---- 加载选中个股信息流 ----
  const loadInfo = useCallback(async (code: string) => {
    setInfoLoading(true);
    setLlmResult(null);
    setChatHistory([]);
    const items: InfoItem[] = [];
    const stock = stocks[code];

    if (stock) {
      const limitPct = stockLimitPct(code);
      const isLU = stock.pct >= limitPct - 0.2;
      const isLD = stock.pct <= -(limitPct - 0.2);
      items.push({
        type: "fund", title: `${stock.name} 实时资金面`,
        summary: `现价${stock.price} | ${fmtPct(stock.pct)} | 主力${fmtMoney(stock.mainNet)}(${fmtPct(stock.mainNetPct)}) | 5日${fmtMoney(stock.mainNet5d)} | 10日${fmtMoney(stock.mainNet10d)} | 换手${stock.turnoverRate}% | 量比${stock.volumeRatio}${isLU ? " | ⚡涨停" : ""}${isLD ? " | ⚡跌停" : ""}`,
        time: new Date().toISOString().slice(11, 16), url: stockRealUrl(code),
        tag: "资金面", tagColor: "bg-sky-500/20 text-sky-300",
      });
      const mainOut = stock.mainNet < 0 && stock.smallNet > 0;
      items.push({
        type: "fund", title: mainOut ? "⚠️ 主力净流出 + 散户净流入（结构偏弱）" : "资金结构正常",
        summary: `超大单${fmtMoney(stock.extraLargeNet)} | 大单${fmtMoney(stock.largeNet)} | 中单${fmtMoney(stock.mediumNet)} | 小单${fmtMoney(stock.smallNet)}`,
        time: "", url: stockRealUrl(code),
        tag: mainOut ? "风险信号" : "资金结构",
        tagColor: mainOut ? "bg-rose-500/20 text-rose-300" : "bg-slate-500/20 text-slate-300",
      });
    }

    // 使用5分钟缓存获取新闻/公告（避免切换/刷新重复打接口）
    const { news, anns } = await fetchInfoCached(code, stock?.name || code);

    for (const n of news) {
      const isNeg = /下跌|利空|暴雷|退市|亏损|减持|违规|处罚|ST|风险|预警|立案|问询/.test(n.title + n.summary);
      const isPos = /利好|上涨|增持|分红|业绩预增|中标|突破|新高|扭亏|回购/.test(n.title + n.summary);
      items.push({ type: "news", title: n.title, summary: n.summary.slice(0, 100),
        time: n.time.slice(5, 16), url: n.url,
        tag: isNeg ? "利空" : isPos ? "利好" : "消息面",
        tagColor: isNeg ? "bg-rose-500/20 text-rose-300" : isPos ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300",
      });
    }
    for (const a of anns) {
      items.push({ type: "announcement", title: a.title, summary: a.columnName ? `[${a.columnName}]` : "",
        time: a.time.slice(5, 16), url: a.url, tag: "公告", tagColor: "bg-amber-500/20 text-amber-300",
      });
    }
    items.sort((a, b) => { if (a.type === "fund" && b.type !== "fund") return -1; if (b.type === "fund" && a.type !== "fund") return 1; return b.time.localeCompare(a.time); });

    // 否决条件检查（新闻+公告标题扫描 + 解禁查询）
    if (stock) {
      const newsTitles = news.map(n => n.title);
      const annTitles = anns.map(a => a.title);
      const liftDays = await fetchLiftBanDays(code);
      setVetoList(buildVetoList(stock, newsTitles, annTitles, liftDays));
    } else {
      setVetoList([]);
    }

    setInfoItems(items);
    setInfoLoading(false);
  }, [stocks]);

  useEffect(() => { if (selected) loadInfo(selected); }, [selected, loadInfo]);

  // ---- 详细研判 ----
  const runDetailLLM = useCallback(async () => {
    if (!apiKey || !selected) return;
    const stock = stocks[selected];
    if (!stock) return;
    setLlmLoading(true); setLlmResult(null); setChatHistory([]);

    const newsCtx = infoItems.filter(i => i.type === "news" || i.type === "announcement").slice(0, 6).map(i => `[${i.tag}] ${i.title}`).join("\n");
    const prompt = buildDetailPrompt(stock, newsCtx);
    try {
      const result = await callLLM(apiKey, [{ role: "user", content: prompt }], 800);
      setLlmResult(result);
      setChatHistory([{ role: "user", content: prompt }, { role: "assistant", content: result }]);
    } catch (err) {
      setLlmResult(`❌ ${err instanceof Error ? err.message : String(err)}`);
    } finally { setLlmLoading(false); }
  }, [apiKey, selected, stocks, infoItems]);

  // ---- 追问 ----
  const handleFollowUp = useCallback(async () => {
    if (!apiKey || !followUp.trim() || !selected) return;
    const stock = stocks[selected];
    if (!stock) return;
    setFollowUpLoading(true);
    const userMsg: ChatMsg = { role: "user", content: `针对${stock.name}(${stock.code})的追问：${followUp}\n\n当前数据快照：现价${stock.price} ${fmtPct(stock.pct)} 主力${fmtMoney(stock.mainNet)} 5日${fmtMoney(stock.mainNet5d)} 换手${stock.turnoverRate}% 量比${stock.volumeRatio}` };
    const newHistory = [...chatHistory, userMsg];
    try {
      const result = await callLLM(apiKey, newHistory, 500);
      const assistantMsg: ChatMsg = { role: "assistant", content: result };
      setChatHistory([...newHistory, assistantMsg]);
      setFollowUp("");
    } catch (err) {
      setChatHistory([...newHistory, { role: "assistant", content: `❌ ${err instanceof Error ? err.message : String(err)}` }]);
    } finally { setFollowUpLoading(false); }
  }, [apiKey, followUp, selected, stocks, chatHistory]);

  // ---- 批量扫描 ----
  const runBatchScan = useCallback(async () => {
    if (!apiKey) return;
    setScanLoading(true);
    const newStocks = { ...stocks };
    for (const code of codes) {
      const s = newStocks[code];
      if (!s) continue;
      try {
        const result = await callLLM(apiKey, [{ role: "user", content: buildScanPrompt(s) }], 60);
        const lines = result.trim().split("\n").filter(l => l.trim());
        const score = parseInt(lines[0]) || 50;
        const tip = lines[1] || "暂无评价";
        newStocks[code] = { ...s, healthScore: Math.max(1, Math.min(100, score)), healthTip: tip };
      } catch {
        newStocks[code] = { ...s, healthScore: null, healthTip: "扫描失败" };
      }
    }
    setStocks(newStocks);
    setScanLoading(false);
  }, [apiKey, codes, stocks]);

  // ---- 添加/删除 ----
  const addStock = () => {
    const code = inputCode.trim();
    if (!code || code.length !== 6 || codes.includes(code) || codes.length >= 30) return;
    const nc = [...codes, code]; setCodes(nc); saveWatchlist(nc); setInputCode(""); setSelected(code);
  };
  const removeStock = (code: string) => {
    const nc = codes.filter(c => c !== code); setCodes(nc); saveWatchlist(nc);
    if (selected === code) setSelected(nc[0] || null);
  };

  // 排序
  const sortedCodes = sortByAlert
    ? [...codes].sort((a, b) => (stocks[b]?.alertCount ?? 0) - (stocks[a]?.alertCount ?? 0))
    : codes;

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-bold text-slate-200">📊 个股监控 · 实时信息流 + AI研判</h3>
        <div className="flex items-center gap-2">
          {apiKey && (
            <button onClick={runBatchScan} disabled={scanLoading}
              className="rounded px-2 py-1 text-[11px] bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 disabled:opacity-40">
              {scanLoading ? "扫描中…" : "🤖 AI批量扫描"}
            </button>
          )}
          <button onClick={() => setSortByAlert(v => !v)}
            className={`rounded px-2 py-1 text-[11px] ${sortByAlert ? "bg-amber-500/20 text-amber-300" : "bg-white/10 text-slate-300"} hover:bg-white/20`}>
            {sortByAlert ? "🔔 异动排序中" : "📊 默认排序"}
          </button>
          <button onClick={refreshStocks}
            className="rounded px-2 py-1 text-[11px] bg-white/10 text-slate-300 hover:bg-white/20">🔄 批量刷新</button>
          <button onClick={() => setShowKeyInput(v => !v)}
            className="rounded px-2 py-1 text-[11px] bg-white/10 text-slate-300 hover:bg-white/20">
            {apiKey ? "🔑 已配置" : "⚙️ 配置API Key"}
          </button>
        </div>
      </div>

      {showKeyInput && (
        <div className="mb-3 flex gap-2 items-center">
          <input value={apiKey} onChange={e => setApiKey(e.target.value)} type="password" placeholder="输入 Agnes AI API Key"
            className="flex-1 rounded bg-black/30 border border-white/10 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-amber-400/50 outline-none" />
          <button onClick={() => { localStorage.setItem(APIKEY_STORAGE, apiKey); setShowKeyInput(false); }}
            className="rounded px-3 py-1.5 text-xs bg-amber-500/20 text-amber-300 hover:bg-amber-500/30">保存</button>
        </div>
      )}

      <div className="flex gap-4" style={{ minHeight: 480 }}>
        {/* ====== 左栏：自选股池 ====== */}
        <div className="w-60 shrink-0 space-y-2">
          <div className="flex gap-1">
            <input value={inputCode} onChange={e => setInputCode(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addStock()}
              placeholder={`输入代码(${codes.length}/30)`} maxLength={6}
              className="flex-1 rounded bg-black/30 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-amber-400/50 outline-none" />
            <button onClick={addStock} disabled={codes.length >= 30}
              className="rounded px-2 py-1.5 text-xs bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40">+</button>
          </div>
          <div className="space-y-1 overflow-y-auto max-h-[420px] pr-1">
            {sortedCodes.map(code => {
              const s = stocks[code];
              const isSel = selected === code;
              return (
                <div key={code} onClick={() => setSelected(code)}
                  className={`relative rounded px-2 py-2 cursor-pointer transition text-xs ${
                    isSel ? "bg-amber-500/15 border border-amber-400/30" : "bg-black/20 border border-white/5 hover:bg-white/5"
                  }`}>
                  {/* 异动角标 */}
                  {s && s.alertCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[11px] font-bold text-white">{s.alertCount}</span>
                  )}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-slate-100">{s?.name || code}</div>
                      <div className="text-[11px] text-slate-500">{code}</div>
                    </div>
                    <div className="text-right">
                      {s ? (
                        <>
                          <div className="font-bold text-slate-100">{s.price.toFixed(2)}</div>
                          <div className={`text-[11px] font-semibold ${pctColor(s.pct)}`}>{fmtPct(s.pct)}</div>
                        </>
                      ) : <div className="text-slate-500">…</div>}
                    </div>
                    <button onClick={e => { e.stopPropagation(); removeStock(code); }}
                      className="ml-1 text-slate-600 hover:text-rose-400 text-[11px]">✕</button>
                  </div>
                  {s && (
                    <div className="mt-1 flex items-center justify-between">
                      <span className={`text-[11px] ${pctColor(s.mainNet)}`}>主力{fmtMoney(s.mainNet)}</span>
                      {s.healthScore != null && (
                        <span className={`rounded px-1 py-0.5 text-[11px] font-bold ${healthColor(s.healthScore)}`}>{s.healthScore}分</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {codes.length === 0 && <div className="text-xs text-slate-500 text-center py-4">输入代码添加监控个股</div>}
          </div>
        </div>

        {/* ====== 右栏：信息流 + AI研判 ====== */}
        <div className="flex-1 min-w-0 space-y-3">
          {selected && stocks[selected] && (
            <div className="flex items-center justify-between">
              <a href={stockRealUrl(selected)} target="_blank" rel="noopener noreferrer"
                className="text-sm font-bold text-amber-300 hover:underline">
                {stocks[selected].name}({selected}) →
              </a>
              <button onClick={runDetailLLM} disabled={llmLoading || !apiKey}
                className="rounded px-3 py-1 text-xs bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 disabled:opacity-40">
                {llmLoading ? "分析中…" : "🤖 AI详细研判"}
              </button>
            </div>
          )}

          {/* 否决条件 badges */}
          {selected && vetoList.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {vetoList.map((v, i) => (
                <span key={i} className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${v.color}`}>⛔ {v.reason}</span>
              ))}
            </div>
          )}

          {/* 制度提示（常驻小字） */}
          {selected && stocks[selected] && (
            <div className="text-[11px] text-slate-600 leading-relaxed">
              T+1：当日买入次日方可卖出 · 本票单日波动上限 ±{stockLimitPct(selected)}%
            </div>
          )}

          {/* AI研判结果 + 追问历史 */}
          {(llmResult || chatHistory.length > 2) && (
            <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 space-y-2 max-h-72 overflow-y-auto">
              <div className="text-[11px] font-bold text-violet-400">🤖 AI 研判（Agnes AI · 六段式）</div>
              {chatHistory.filter(m => m.role === "assistant").map((m, i) => (
                <div key={i} className="text-xs text-violet-200 whitespace-pre-wrap leading-relaxed border-b border-violet-500/10 pb-2 mb-2 last:border-0 last:mb-0 last:pb-0">
                  {i > 0 && <div className="text-[11px] text-violet-400/60 mb-1">追问回复 #{i}</div>}
                  {m.content}
                </div>
              ))}
              <div className="text-[11px] text-violet-400/60">⚠️ AI 分析仅供参考，不构成投资建议</div>
            </div>
          )}

          {/* 追问输入框 */}
          {llmResult && apiKey && (
            <div className="flex gap-2">
              <input value={followUp} onChange={e => setFollowUp(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !followUpLoading && handleFollowUp()}
                placeholder="追问（如：适合现在加仓吗？明天低开怎么处理？）"
                className="flex-1 rounded bg-black/30 border border-violet-500/20 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-violet-400/50 outline-none" />
              <button onClick={handleFollowUp} disabled={followUpLoading || !followUp.trim()}
                className="rounded px-3 py-1.5 text-xs bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 disabled:opacity-40 shrink-0">
                {followUpLoading ? "…" : "追问"}
              </button>
            </div>
          )}

          {/* 信息流 */}
          <div ref={scrollRef} className="h-64 overflow-y-auto rounded-lg border border-white/10 bg-black/20 [scrollbar-width:thin]">
            {infoLoading ? (
              <div className="flex items-center justify-center h-full text-xs text-slate-500">加载信息中…</div>
            ) : infoItems.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-slate-500">
                {selected ? "暂无信息" : "← 选择一只个股查看信息流"}
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {infoItems.map((item, i) => (
                  <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                    className="block px-3 py-2.5 hover:bg-white/5 transition">
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${item.tagColor}`}>{item.tag}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-slate-200 line-clamp-2">{item.title}</div>
                        {item.summary && <div className="mt-0.5 text-[11px] text-slate-400 line-clamp-1">{item.summary}</div>}
                      </div>
                      {item.time && <span className="shrink-0 text-[11px] text-slate-500">{item.time}</span>}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-slate-600">
        自选股池（{codes.length}/30）保存在浏览器本地。异动信号：主力出散户进/涨跌停/量比&gt;2.5/换手&gt;15%/持续流出。
        AI研判由 Agnes AI 提供，追问支持多轮对话。
      </div>
    </section>
  );
}

// ============================================================
// V13-1（P0）：新闻驱动作战管线（简化版）—— 前端共享纯函数
// 4 步：规则抽主题 → LLM 行情分析 → 规则选股 → LLM 标的研判
// 复用：classifyStock / dataStore / stockPicker（管线编排见 server/cron.js runThemeAnalysis）
// 输出：ThemeAnalysisResult → kv_store（theme_analysis:日期:时分 + theme_analysis:latest）→ EventClassifyPanel
// ============================================================
import { conceptGroupOf } from "./conceptGroups";

export interface ThemeHeat {
  name: string;          // 主题大类名（24 大类之一）
  heat: number;          // 热度 0-100
  trend: "up" | "down" | "new" | "flat";
  evidence: string[];    // 支撑新闻标题（≤3 条）
}

export interface ThemeAnalysis {
  theme: string;
  heat: number;
  trend: string;
  verdict: string;       // 领涨龙头 / 潜力起爆 / 风险警示
  fundAnalysis: string;  // 资金面分析（引用数字）
  action: string;        // 操作建议
  picks?: Array<{
    code: string; name: string; role: string;
    buyTrigger: string; stopLoss: string; risk: string;
    aiVerdict?: string;  // LLM 研判
  }>;
}

export interface ThemeAnalysisResult {
  date: string;
  time: string;
  round: number;
  themes: Array<{
    theme: string;
    heat: number;
    trend: string;
    verdict: string;
    fundAnalysis: string;
    action: string;
    picks: Array<{ code: string; name: string; role: string; buyTrigger: string; stopLoss: string; risk: string; aiVerdict?: string }>;
  }>;
}

// Step 1（规则，0 LLM）：从快讯抽取主题热度
// 逻辑：每条快讯标题 → conceptGroupOf 折叠到 24 大类 → 计数 → 热度 = min(100, 条数×15) → TOP 10
export function extractThemeHeat(newsItems: Array<{ title: string; time: string }>): ThemeHeat[] {
  const tally = new Map<string, { count: number; titles: string[]; latest: string }>();
  for (const n of newsItems) {
    const group = conceptGroupOf(n.title); // 关键词 → 24 大类
    if (!group) continue;
    const prev = tally.get(group) ?? { count: 0, titles: [], latest: "" };
    prev.count++;
    if (prev.titles.length < 3) prev.titles.push(n.title.slice(0, 40));
    prev.latest = n.time;
    tally.set(group, prev);
  }
  // 热度 = min(100, 条数 × 15)
  return [...tally.entries()]
    .map(([name, v]) => ({
      name,
      heat: Math.min(100, v.count * 15),
      trend: "flat" as const,
      evidence: v.titles,
    }))
    .sort((a, b) => b.heat - a.heat)
    .slice(0, 10); // TOP 10 主题
}

// Step 2 prompt 生成（给 Agnes 的行情联动分析）
export function buildAnalysisPrompt(
  themes: ThemeHeat[],
  fundData: Array<{ name: string; mainNet: number; mainNet5d: number; pct: number }>,
): string {
  return `你是10年A股游资分析师。基于以下主题热度+板块资金数据，对每个主题做行情联动分析。

主题热度+资金：
${JSON.stringify(themes.map(t => ({
  theme: t.name, heat: t.heat, evidence: t.evidence,
  fund: fundData.find(f => f.name === t.name) ?? null,
})))}

规则：
- 资金持续流入(5d>0)+热度高 → "领涨龙头"
- 资金近期回流(1d>0 但 5d 可能<0)+热度上升 → "潜力起爆"
- 热度高但资金流出(1d<0) → "风险警示"

输出严格JSON数组：
[{"theme":"主题名","verdict":"领涨龙头|潜力起爆|风险警示","fundAnalysis":"≤40字引用具体数字","action":"≤20字操作建议"}]`;
}

// Step 4 prompt 生成（标的研判）
export function buildStockPrompt(
  picks: Array<{ code: string; name: string; role: string; boardCount: number; pct: number; sealFund: number; amount: number; mainNet: number }>,
): string {
  return `对以下标的做一句话研判+买入触发+止损+风险，只输出JSON数组：
${JSON.stringify(picks)}

输出格式：[{"code":"代码","verdict":"可买|谨慎|回避","buyTrigger":"≤30字具体触发条件(价格+量能)","stopLoss":"≤20字","risk":"≤30字"}]`;
}

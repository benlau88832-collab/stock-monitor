// ============================================================
// src/lib/intentRouter.ts —— 意图路由（v9.113.0，T2-1）
// 终审 D-02：'总结/大盘'类纯摘要问误进笨重 ReAct → 降级。
// 三档路由：summary(流式小prompt) / data(直读PG秒回) / decision(决策直达) / react(ReAct) / research(深度调研)
// 默认 summary 兜底（最可靠）；正则精确，防过宽误伤。
// ============================================================

export type Intent = "summary" | "data" | "decision" | "react" | "research";

export function classifyIntent(q: string): Intent {
  const t = q.trim();
  if (!t) return "summary";
  // 深度调研（保留妙想工具）
  if (/个股深度调研/.test(t)) return "research";
  // 决策类（需准入/仓位/离场工具）
  if (/能不能上车|可不可以买|能不能买|仓位|止损|加仓|减仓|能不能上|要不要买|买不买|值得买/.test(t) || /\d{6}(怎么样|能不能|分析)/.test(t)) return "decision";
  // 纯数据类（直读 PG，不烧 LLM）
  if (/涨停(数|家数|多少)|跌停数|成交额|情绪(多少|分)|炸板率|溢价|涨跌(家数|比)/.test(t)) return "data";
  // 纯摘要类（流式小 prompt）
  if (/一句话|总结|简述|概述|概况|速览|复盘|盘面|大盘|情绪如何|市场怎么样|今天(情况|行情)/.test(t)) return "summary";
  // 消息/主线/外围 → ReAct
  if (/消息|新闻|政策|主线|龙头|跟风|外盘|美股|纳指|隔夜|事件/.test(t)) return "react";
  return "summary"; // 默认走流式（最可靠）
}

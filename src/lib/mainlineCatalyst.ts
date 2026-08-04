// 主线深度催化聚合（v9.25）
// 从 dataStore 的快讯+公告中按主线名匹配，提取"业绩/收入指引/政策/中标"等深度催化信号
// 注入到 rankMainlinesWithLLM 的 payload，让 LLM 看到除涨停梯队外的真实催化（如"药明康德业绩大增"）

import type { NewsItem, AnnItem } from "./llmNewsIntelligence";

// 强催化关键词：业绩/收入指引/政策/重大突破（命中即纳入）
const STRONG_CATALYST = /业绩大增|业绩预增|净利润|利润大增|收入指引|指引上调|上调指引|业绩翻倍|业绩超预期|中标|签约大单|突破|获批|新药获批|上市获批|政策利好|重大利好|龙头效应|订单激增|获准入|放量|业绩高增/;

// 中等催化：行业层面 / 板块利好
const MID_CATALYST = /利好|上涨|增持|分红|回购|扭亏|重大|合作|投产|扩产|重组|设立|获|新增|产能|核心客户|前五大|海外订单/;

// 负向催化：触发风险预警
const NEG_CATALYST = /减持|利空|暴雷|亏损|减产|立案|被罚|诉讼|终止|取消|下调|违规|跌停/;

// 主线名子词匹配（与 NewsPanel 的 matchMainlineByText 保持一致：拆分 /、空格、子词长度≥2）
function hitMainline(text: string, mainline: string): boolean {
  const subs = mainline.split(/[/·、,，\s]+/).filter(s => s.length >= 2);
  return subs.some(sub => text.includes(sub) || sub.includes(text));
}

export interface CatalystItem {
  /** "业绩" / "政策" / "公告" 等类型 */
  type: string;
  /** 摘要（≤50字） */
  text: string;
  /** true=强催化（业绩/政策/中标等），false=普通利好 */
  strong: boolean;
  /** 来源：news / ann */
  source: "news" | "ann";
  /** 个股名（公告时） */
  stockName?: string;
}

/**
 * 为一组主线分别聚合催化清单
 * @param mainlines 主线名列表
 * @param newsItems dataStore 近 N 日快讯
 * @param annItems dataStore 近 N 日公告
 * @returns Map<主线名, 强催化摘要字符串[]>
 */
export function buildMainlineCatalysts(
  mainlines: string[],
  newsItems: NewsItem[],
  annItems: AnnItem[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();

  for (const m of mainlines) {
    const catalysts: string[] = [];

    // 公告：业绩类强催化（药明康德"业绩大增"就来自这里）
    for (const a of annItems) {
      const text = a.title;
      if (!hitMainline(text, m) && !a.boards?.some(b => hitMainline(b, m))) continue;
      const strong = STRONG_CATALYST.test(text);
      const neg = NEG_CATALYST.test(text);
      if (strong && !neg) {
        catalysts.push(`【业绩·${a.stockName ?? ""}】${a.title.replace(/【[^】]*】/g, "").slice(0, 40)}`);
      } else if (neg) {
        catalysts.push(`【风险·${a.stockName ?? ""}】${a.title.replace(/【[^】]*】/g, "").slice(0, 40)}`);
      } else if (MID_CATALYST.test(text) && catalysts.length < 6) {
        catalysts.push(`【公告·${a.stockName ?? ""}】${a.title.replace(/【[^】]*】/g, "").slice(0, 30)}`);
      }
    }

    // 快讯：政策/事件类强催化
    for (const n of newsItems) {
      const text = n.title + n.summary;
      if (!hitMainline(text, m) && !n.boards?.some(b => hitMainline(b, m))) continue;
      const strong = STRONG_CATALYST.test(text);
      const neg = NEG_CATALYST.test(text);
      if (strong && !neg && catalysts.length < 6) {
        catalysts.push(`【快讯】${n.title.replace(/【[^】]*】/g, "").slice(0, 40)}`);
      } else if (neg && catalysts.length < 6) {
        catalysts.push(`【风险·快讯】${n.title.replace(/【[^】]*】/g, "").slice(0, 40)}`);
      } else if (MID_CATALYST.test(text) && catalysts.length < 6) {
        catalysts.push(`【快讯】${n.title.replace(/【[^】]*】/g, "").slice(0, 30)}`);
      }
    }

    // 去重 + 强催化排前
    const seen = new Set<string>();
    const dedup: string[] = [];
    for (const c of catalysts) {
      if (seen.has(c)) continue;
      seen.add(c);
      dedup.push(c);
      if (dedup.length >= 6) break;
    }
    if (dedup.length > 0) out.set(m, dedup);
  }

  return out;
}

/** 把 catalysts map 简化为每条主线的强催化摘要字符串数组（用于 LLM payload） */
export function summarizeCatalysts(map: Map<string, string[]>): string[] {
  const out: string[] = [];
  for (const [mainline, items] of map.entries()) {
    const strong = items.filter(s => s.startsWith("【业绩") || s.startsWith("【快讯"));
    if (strong.length > 0) {
      out.push(`${mainline}: ${strong.slice(0, 3).join("；")}`);
    }
  }
  return out;
}
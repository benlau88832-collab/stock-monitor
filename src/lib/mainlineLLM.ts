// LLM 主线精排引擎（v9.16）
// Agnes 2.5 Flash：识别"真主线 vs 一日游脉冲"，主线排名，龙头确认，给逻辑理由
// 复用 callAI 中枢（缓存/限速/降级）
// 五条红线：① LLM 只产出文本/排序判断 ② 规则机分数始终保留 ③ 超时/失败降级回规则
// ④ payload 只放稳定内容（板块名/涨停数/高度/龙头名/新闻标题，不放内部权重）
// ⑤ temperature 0.1、不流式、不开 thinking

import { callAI, parseAIJSON, type AIResult } from "./ai";
import type { MarketStyleInfo } from "./mainline";
import type { MainlineGroup } from "./stockToMainline";

// ============== 输出结构 ==============
export interface MainlineLLMLeader {
  code: string;
  name: string;
  role: string;        // 龙一/龙二/龙三
  reason: string;      // ≤20字
}

export interface MainlineLLMResult {
  board: string;
  rank: number;            // 1=第一主线
  isPulse: boolean;        // true=一日游脉冲（LLM判定）
  confidence: number;      // 0-100
  leaders: MainlineLLMLeader[];
  logic: string;           // ≤40字逻辑
  caution: string;         // ≤20字风险提示（可选）
  fromLLM: boolean;        // false=降级
}

// ============== 主入口 ==============
/**
 * 批量精排主线（每轮 ≤1 次调用）
 * @param candidates 规则机候选（已排序，取前 6 个）
 * @param style      市场风格（供 LLM 参考）
 */
export async function rankMainlinesWithLLM(
  candidates: MainlineGroup[],
  style: MarketStyleInfo,
): Promise<MainlineLLMResult[]> {
  if (candidates.length === 0) return [];

  // payload：只放稳定内容
  const payload = candidates.slice(0, 6).map(c => ({
    board: c.mainline,
    zt: c.ztCount,
    height: c.height,
    leader: c.leaders[0]?.name ?? "",
    fund: Math.round(c.mainNet / 1e8),  // 亿
    news: c.newsTitles.slice(0, 3),
  }));

  const result: AIResult = await callAI("stockJudge", {
    prompt: `你是A股十年经验的龙头战法分析师（游资+机构双视角），只输出JSON，不输出任何其他文字或markdown标记。

任务：对候选主线排序，识别真主线 vs 一日游脉冲，确认龙头，给逻辑。

市场环境：${style.label}（风险偏好${style.riskAppetite}）

候选主线（涨停数/最高板/龙一候选/主力净流入亿/相关新闻）：
${JSON.stringify(payload)}

判断规则：
- 涨停数多 + 高度高 + 有政策/事件催化 = 真主线，rank 靠前
- 纯情绪脉冲无催化 = isPulse=true
- 龙头确认：连板最高+封板最早通常为真龙；有板块中军（成交额大）加分
- confidence = 该主线可信度 0-100

输出格式（严格JSON数组，按 rank 升序）：
[{"board":"板块名","rank":1,"isPulse":false,"confidence":80,"leaders":[{"code":"代码","name":"名称","role":"龙一","reason":"≤20字"}],"logic":"≤40字","caution":"≤20字"}]`,
  });

  // 降级：LLM 失败 → 规则机排名（不标记 fromLLM）
  if (result.degraded) {
    return candidates.map((c, i) => ({
      board: c.mainline,
      rank: i + 1,
      isPulse: c.score < 45,
      confidence: c.score,
      leaders: c.leaders.map(l => ({ code: l.code, name: l.name, role: l.role, reason: l.reason })),
      logic: `规则引擎：涨停${c.ztCount}家·${c.height}板·资金${(c.mainNet / 1e8).toFixed(0)}亿`,
      caution: c.score < 45 ? "强度偏弱，注意风险" : "",
      fromLLM: false,
    }));
  }

  return parseLLMMainlineResult(result.text, candidates);
}

// ============== 容错解析 ==============
function parseLLMMainlineResult(raw: string, candidates: MainlineGroup[]): MainlineLLMResult[] {
  const arr = parseAIJSON<Array<Record<string, unknown>>>(raw, ["board", "rank"]);
  if (!arr || !Array.isArray(arr)) return degradeToRules(candidates);

  const resultMap = new Map<string, MainlineLLMResult>();
  for (const item of arr) {
    const board = String(item.board ?? "");
    if (!board) continue;
    const rank = Math.max(1, Math.min(10, Number(item.rank) || 1));
    const leadersRaw = Array.isArray(item.leaders) ? item.leaders : [];
    const leaders: MainlineLLMLeader[] = leadersRaw.slice(0, 3).map((l: Record<string, unknown>) => ({
      code: String(l.code ?? ""),
      name: String(l.name ?? ""),
      role: String(l.role ?? ""),
      reason: String(l.reason ?? "").slice(0, 20),
    }));
    resultMap.set(board, {
      board,
      rank,
      isPulse: Boolean(item.isPulse),
      confidence: Math.max(0, Math.min(100, Number(item.confidence) || 50)),
      leaders,
      logic: String(item.logic ?? "").slice(0, 40),
      caution: String(item.caution ?? "").slice(0, 20),
      fromLLM: true,
    });
  }

  // 补齐候选（LLM 可能漏掉），按 rank 升序
  const merged: MainlineLLMResult[] = [];
  for (const c of candidates) {
    const llm = resultMap.get(c.mainline);
    if (llm) {
      merged.push(llm);
    } else {
      merged.push({
        board: c.mainline,
        rank: candidates.indexOf(c) + 1,
        isPulse: c.score < 45,
        confidence: c.score,
        leaders: c.leaders.map(l => ({ code: l.code, name: l.name, role: l.role, reason: l.reason })),
        logic: `规则引擎：涨停${c.ztCount}家·${c.height}板·资金${(c.mainNet / 1e8).toFixed(0)}亿`,
        caution: "",
        fromLLM: false,
      });
    }
  }
  merged.sort((a, b) => a.rank - b.rank);
  return merged;
}

/** 规则降级 */
function degradeToRules(candidates: MainlineGroup[]): MainlineLLMResult[] {
  return candidates.map((c, i) => ({
    board: c.mainline,
    rank: i + 1,
    isPulse: c.score < 45,
    confidence: c.score,
    leaders: c.leaders.map(l => ({ code: l.code, name: l.name, role: l.role, reason: l.reason })),
    logic: `规则引擎：涨停${c.ztCount}家·${c.height}板·资金${(c.mainNet / 1e8).toFixed(0)}亿`,
    caution: c.score < 45 ? "强度偏弱，注意风险" : "",
    fromLLM: false,
  }));
}

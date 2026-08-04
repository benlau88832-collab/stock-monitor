// LLM 消息维度接入（Agnes 2.5 Flash）
// 五条红线：① LLM只产出文本判断维度 ② 总分由规则机合成
// ③ 作战卡先规则分渲染，LLM异步补位 ④ payload只放稳定内容
// ⑤ temperature 0.1、不流式、不开thinking、超时走降级

import { callAI, parseAIJSON, type AIResult } from "./ai";

// ============== 题材消息评分 ==============
export interface ThemeNewsLLMResult {
  board: string;
  catalyst: number;      // 0-100
  polarity: string;      // 利好|利空|中性
  novelty: string;       // 新|续|旧
  reason: string;        // ≤30字
  fromLLM: boolean;      // true=LLM, false=规则版降级
}

/** 批量评估题材催化（每轮≤1次调用） */
export async function scoreThemeNews(
  boards: Array<{ board: string; stage: string; news: string[] }>,
): Promise<ThemeNewsLLMResult[]> {
  if (boards.length === 0) return [];

  // 构造 payload（只放标题/板块名/阶段名，不放数值）
  const payload = boards.map(b => ({
    board: b.board,
    stage: b.stage,
    news: b.news.slice(0, 6), // ≤6条
  }));

  // 调用 AI（走 callAI 中枢的缓存/限速/降级）
  // 注意：TASK_CONFIG 里 annRank 已是 t=0.1，复用其参数槽
  // 但我们构造自己的 prompt，直接用 stockJudge 任务透传
  const result: AIResult = await callAI("mainlineRank", {
    prompt: `你是A股短线题材分析引擎，只输出JSON数组，不输出任何其他文字或markdown标记。

评分纪律：
- 国常会/央行/证监会级新政: 85-100
- 部委/行业政策: 65-84
- 事件级催化: 40-64
- novelty=旧则catalyst≤50
- 利空题材: ≤30

输入板块与最新消息：
${JSON.stringify(payload)}

输出格式（严格JSON数组）：
[{"board":"板块名","catalyst":数字0-100,"polarity":"利好|利空|中性","novelty":"新|续|旧","reason":"≤30字"}]`,
  });

  // 降级处理
  if (result.degraded) {
    return boards.map(b => ({
      board: b.board, catalyst: 50, polarity: "中性", novelty: "续",
      reason: "规则版", fromLLM: false,
    }));
  }

  // 容错解析
  const parsed = parseLLMThemeResult(result.text, boards);
  return parsed;
}

/** 容错解析题材 LLM 返回 */
function parseLLMThemeResult(
  raw: string,
  boards: Array<{ board: string }>,
): ThemeNewsLLMResult[] {
  const arr = parseAIJSON<Array<Record<string, unknown>>>(raw, ["board", "catalyst"]);
  if (!arr) {
    // 整批失败 → 规则版
    return boards.map(b => ({
      board: b.board, catalyst: 50, polarity: "中性", novelty: "续",
      reason: "解析失败", fromLLM: false,
    }));
  }

  const resultMap = new Map<string, ThemeNewsLLMResult>();
  for (const item of arr) {
    const board = String(item.board ?? "");
    if (!board) continue;
    const catalyst = Math.max(0, Math.min(100, item.catalyst != null ? Number(item.catalyst) : 50));
    resultMap.set(board, {
      board,
      catalyst,
      polarity: String(item.polarity ?? "中性"),
      novelty: String(item.novelty ?? "续"),
      reason: String(item.reason ?? "").slice(0, 30),
      fromLLM: true,
    });
  }

  // 补全缺失板块（LLM 可能漏掉）
  return boards.map(b => resultMap.get(b.board) ?? {
    board: b.board, catalyst: 50, polarity: "中性", novelty: "续",
    reason: "LLM未返回", fromLLM: false,
  });
}

// ============== 个股消息评分 ==============
export interface StockNewsLLMResult {
  code: string;
  msgScore: number;        // 0-100
  polarity: string;
  invalidation: string;    // ≤20字失效条件
  fromLLM: boolean;
}

/** 批量评估个股消息（每轮≤1次调用） */
export async function scoreStockNews(
  stocks: Array<{ code: string; name: string; news: string[] }>,
): Promise<StockNewsLLMResult[]> {
  if (stocks.length === 0) return [];

  const payload = stocks.map(s => ({
    code: s.code,
    name: s.name,
    news: s.news.slice(0, 6),
  }));

  const result: AIResult = await callAI("mainlineRank", {
    prompt: `你是A股个股消息分析引擎，只输出JSON数组，不输出任何其他文字或markdown标记。

评分：利好消息越重大越高(80-100为重大利好)，中性50，利空≤30。

输入个股与最新消息/公告：
${JSON.stringify(payload)}

输出格式（严格JSON数组）：
[{"code":"代码","msgScore":数字0-100,"polarity":"利好|利空|中性","invalidation":"≤20字事件型失效条件"}]`,
  });

  if (result.degraded) {
    return stocks.map(s => ({
      code: s.code, msgScore: 50, polarity: "中性",
      invalidation: "", fromLLM: false,
    }));
  }

  return parseLLMStockResult(result.text, stocks);
}

/** 容错解析个股 LLM 返回 */
function parseLLMStockResult(
  raw: string,
  stocks: Array<{ code: string }>,
): StockNewsLLMResult[] {
  const arr = parseAIJSON<Array<Record<string, unknown>>>(raw, ["code", "msgScore"]);
  if (!arr) {
    return stocks.map(s => ({
      code: s.code, msgScore: 50, polarity: "中性",
      invalidation: "", fromLLM: false,
    }));
  }

  const resultMap = new Map<string, StockNewsLLMResult>();
  for (const item of arr) {
    const code = String(item.code ?? "");
    if (!code) continue;
    resultMap.set(code, {
      code,
      msgScore: Math.max(0, Math.min(100, item.msgScore != null ? Number(item.msgScore) : 50)),
      polarity: String(item.polarity ?? "中性"),
      invalidation: String(item.invalidation ?? "").slice(0, 20),
      fromLLM: true,
    });
  }

  return stocks.map(s => resultMap.get(s.code) ?? {
    code: s.code, msgScore: 50, polarity: "中性",
    invalidation: "", fromLLM: false,
  });
}

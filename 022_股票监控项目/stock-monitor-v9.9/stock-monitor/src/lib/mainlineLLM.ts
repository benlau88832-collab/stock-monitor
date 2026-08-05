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
 * @param catalysts  深度催化信息（业绩/收入指引/政策/中标等），key=主线名 → 摘要列表
 */
export async function rankMainlinesWithLLM(
  candidates: MainlineGroup[],
  style: MarketStyleInfo,
  catalysts?: Map<string, string[]>,
): Promise<MainlineLLMResult[]> {
  if (candidates.length === 0) return [];

  // payload：涨停梯队 + 深度催化
  const payload = candidates.slice(0, 6).map(c => ({
    board: c.mainline,
    zt: c.ztCount,
    height: c.height,
    leader: c.leaders[0]?.name ?? "",
    fund: Math.round(c.mainNet / 1e8),  // 亿
    news: c.newsTitles.slice(0, 3),
    // v9.25：注入深度催化（业绩/收入指引/中标等）— LLM 看到这条信息后会识别到"医药生物 - 药明康德业绩大增"类强催化
    catalyst: catalysts?.get(c.mainline) ?? [],
  }));

  // 提取强催化摘要作为顶层提示（让 LLM 优先关注）
  const catalystLines: string[] = [];
  if (catalysts) {
    for (const [k, v] of catalysts.entries()) {
      const strong = v.filter(s => s.includes("【业绩") || s.includes("【快讯"));
      if (strong.length > 0) catalystLines.push(`- ${k}: ${strong.slice(0, 2).join("；")}`);
    }
  }

  // v9.26 F-05：使用专用 mainlineRank 任务（thinking=false, temp 0.1）——不再复用 stockJudge(thinking=true 会拉长延迟)
  // v9.28（P1-10）：schema 精简 + 两阶段推理 —— 去掉可选字段 caution 减轻输出负担；
  //   明确"先判脉冲、再排序"两阶段，避免 flash 一次塞太多任务而漏字段
  const result: AIResult = await callAI("mainlineRank", {
    prompt: `你是A股十年经验的龙头战法分析师（游资+机构双视角），只输出JSON，不输出任何其他文字或markdown标记。

任务：分两步完成主线精排。
第一步【脉冲判别】：对每条候选先判断 isPulse —— 有深度催化（业绩大增/收入指引上调/中标大单/重磅政策）且涨停梯队完整 = false（真主线）；纯情绪炒作无催化 = true（一日游脉冲）。
第二步【强度排序】：排除明显脉冲后，按"催化强度 > 涨停数 > 连板高度 > 主力资金"对剩余真主线排序，rank=1 为最强主线。

市场环境：${style.label}（风险偏好${style.riskAppetite}）

${catalystLines.length > 0 ? `【重要·近期深度催化】\n${catalystLines.join("\n")}\n` : ""}候选主线（涨停数/最高板/龙一候选/主力净流入亿/相关新闻/深度催化）：
${JSON.stringify(payload)}

判断规则（重要）：
- 有强业绩催化（业绩大增/收入指引上调/中标大单）的主线 → rank 显著优先，confidence ≥80
- 有强政策催化（行业重磅利好/新政策落地）的主线 → rank 优先
- 涨停数多 + 高度高 + 有深度催化 = 真主线，最强主线
- 纯情绪脉冲无深度催化 = isPulse=true，rank 靠后
- 强负向催化（减持/暴雷/亏损/立案）→ rank 显著降低，confidence 折扣
- 龙头确认：连板最高+封板最早通常为真龙；与深度催化方向一致更可信
- confidence = 该主线可信度 0-100

输出格式（严格JSON数组，按 rank 升序；仅 6 个字段，leaders 只给龙一）：
[{"board":"板块名","rank":1,"isPulse":false,"confidence":80,"leaders":[{"code":"代码","name":"名称","role":"龙一","reason":"≤20字"}],"logic":"≤40字"}]`,
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

// ============== 容错解析（v9.26 F-07：候选白名单校验） ==============
function parseLLMMainlineResult(raw: string, candidates: MainlineGroup[]): MainlineLLMResult[] {
  const arr = parseAIJSON<Array<Record<string, unknown>>>(raw, ["board", "rank"]);
  if (!arr || !Array.isArray(arr)) return degradeToRules(candidates);

  // F-07：构建白名单 —— board 必须来自输入候选；code 必须属于该候选的龙头池
  const boardSet = new Set(candidates.map(c => c.mainline));
  const codeByBoard = new Map<string, Set<string>>();
  for (const c of candidates) {
    codeByBoard.set(c.mainline, new Set(c.leaders.map(l => l.code).filter(Boolean)));
  }

  const resultMap = new Map<string, MainlineLLMResult>();
  const usedRanks = new Set<number>();
  for (const item of arr) {
    const board = String(item.board ?? "");
    // 白名单 1：board 必须存在于输入候选集（幻觉板块直接丢弃）
    if (!board || !boardSet.has(board)) continue;
    // 白名单 2：rank 唯一（1..N）
    const rank = Math.max(1, Math.min(candidates.length, Number(item.rank) || 1));
    if (usedRanks.has(rank)) continue;
    usedRanks.add(rank);

    const leadersRaw = Array.isArray(item.leaders) ? item.leaders : [];
    const allowedCodes = codeByBoard.get(board) ?? new Set<string>();
    const leaders: MainlineLLMLeader[] = [];
    for (const l of leadersRaw.slice(0, 3)) {
      const lr = l as Record<string, unknown>;
      const code = String(lr.code ?? "");
      // 白名单 3：code 必须属于该候选的龙头池（模型不可凭空造股票）
      if (!allowedCodes.has(code)) continue;
      leaders.push({
        code,
        name: String(lr.name ?? ""),
        role: String(lr.role ?? ""),
        reason: String(lr.reason ?? "").slice(0, 20),
      });
    }

    resultMap.set(board, {
      board,
      rank,
      isPulse: Boolean(item.isPulse),
      confidence: Math.max(0, Math.min(100, Number(item.confidence) || 50)),
      leaders,
      logic: String(item.logic ?? "").slice(0, 40),
      // v9.28（P1-10）：caution 不再要求 LLM 必填 → 低置信度时规则推导
      caution: String(item.caution ?? (Math.max(0, Math.min(100, Number(item.confidence) || 50)) < 60 ? "强度偏弱，注意风险" : "")).slice(0, 20),
      fromLLM: true,
    });
  }

  // 补齐候选（LLM 可能漏掉），按 rank 升序；漏掉的用规则机排序补位
  const merged: MainlineLLMResult[] = [];
  let nextRank = 1;
  for (const c of candidates) {
    const llm = resultMap.get(c.mainline);
    if (llm) {
      merged.push(llm);
    } else {
      merged.push({
        board: c.mainline,
        rank: nextRank,
        isPulse: c.score < 45,
        confidence: c.score,
        leaders: c.leaders.map(l => ({ code: l.code, name: l.name, role: l.role, reason: l.reason })),
        logic: `规则引擎：涨停${c.ztCount}家·${c.height}板·资金${(c.mainNet / 1e8).toFixed(0)}亿`,
        caution: "",
        fromLLM: false,
      });
    }
    nextRank += 1;
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

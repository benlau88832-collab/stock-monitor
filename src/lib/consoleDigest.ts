// ============================================================
// v9.84.2（AI大脑层 · 3.3）：AIConsole 对话结论回写
// 目标：对话不再"说过就忘" ——
//  ① 回复中含个股裁决 → 写入 aiConclusionStore（个股雷达旁标 AI 裁决）
//  ② 回复中含明确动作判断 → 追加 decision_log:日期（决策审计面板时间线可见，可复盘可追责）
// 轻量正则解析（不额外调 LLM，零成本）；识别不到就静默跳过。
// ============================================================
import { setStockAI } from "./aiConclusionStore";

function localDateStr(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

/** 从回复中识别动作词 → DecisionLog.action 三态 */
function actionOf(reply: string): "可上车" | "观望" | "禁止" | null {
  if (/禁止|不建议买|回避|别买|不碰|放弃/.test(reply)) return "禁止";
  if (/可上车|可以买|建议买入|建议上车|买入|建仓|可买/.test(reply)) return "可上车";
  if (/观望|谨慎|等待|观察|暂不/.test(reply)) return "观望";
  return null;
}

/**
 * 消化一次 AIConsole 回复（纯函数 + 副作用写两处 store）
 * @param reply AI 最终答复文本
 * @param toolsCalled 本轮已调用的工具名列表
 * @param mainline 当前最强主线（有则记入决策日志主线维度）
 */
export function digestConsoleReply(reply: string, toolsCalled: string[], mainline?: string): void {
  if (!reply) return;

  // ① 个股裁决 → aiConclusionStore（雷达/消息面旁标；取前 3 个明确裁决防刷屏）
  const stockRe = /(\d{6})[^\d]{0,14}(可买|可上车|建议买入|建议上车|买入|回避|不建议|谨慎|观望)/g;
  let matched = 0;
  for (const m of reply.matchAll(stockRe)) {
    if (matched++ >= 3) break;
    const code = m[1];
    const word = m[2];
    const verdict = /回避|不建议/.test(word) ? "回避" : /谨慎|观望/.test(word) ? "谨慎" : "可买";
    setStockAI({ code, verdict, reason: reply.replace(/\n/g, " ").slice(0, 120), ts: Date.now() });
  }

  // ② 决策审计落库（仅当调过工具且回复含明确动作 → 视为一次"对话裁决"）
  const action = actionOf(reply);
  if (action && toolsCalled.length > 0) {
    try {
      const key = `decision_log:${localDateStr()}`;
      const arr = JSON.parse(localStorage.getItem(key) ?? "[]");
      arr.push({
        ts: new Date().toISOString(),
        mainline: mainline ?? "对话",
        action,
        confidence: action === "观望" ? 50 : 65,
        source: "AI-对话",
        toolsCalled: toolsCalled.slice(0, 6),
        agentReason: reply.replace(/\n/g, " ").slice(0, 100),
      });
      localStorage.setItem(key, JSON.stringify(arr.slice(-50)));
    } catch { /* 日志失败不影响对话 */ }
  }
}

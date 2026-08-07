// ============================================================
// v9.66：个股深度调研工具组（供 AIConsole 全站 AI 助手使用）
// 后端能力：server /api/research/*（妙想 mx-data/mx-search 中转）+ /api/watch/*（盯价监控）
// 前端工具：execute 调 server API（Key 只存 server/.env，符合红线）
// 五段式流程（stock-deep-research-v2）：Phase 0 速览 → 1 财务 → 2 消息 → 3 行业 → 4 评级
// ============================================================
import type { AgentTool } from "./agentTools";

async function serverGet<T>(path: string): Promise<T> {
  const r = await fetch(path);
  return r.json() as Promise<T>;
}

async function serverPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json() as Promise<T>;
}

export function getResearchTools(): AgentTool[] {
  return [
    {
      name: "researchQuote",
      description: '个股行情/估值速览（妙想）：最新价、总市值、PE、近1月涨跌幅 —— 传 code 如 {"code":"600522"}。深度调研 Phase 0 用',
      kind: "data",
      execute: async (args: any) => serverGet(`/api/research/quote?code=${encodeURIComponent(String(args?.code ?? ""))}`),
    },
    {
      name: "researchData",
      description: '妙想结构化数据查询（财务三表/股东/研报/龙虎榜等）—— 传 q 自然语言问句如 {"q":"600522 最近3年营业收入 净利润"}。深度调研 Phase 1/3 用',
      kind: "data",
      execute: async (args: any) => serverGet(`/api/research/data?q=${encodeURIComponent(String(args?.q ?? ""))}`),
    },
    {
      name: "researchSearch",
      description: '妙想资讯搜索（新闻/公告/研报/政策）—— 传 q 如 {"q":"中天科技 最新研报"}。深度调研 Phase 2 用',
      kind: "data",
      execute: async (args: any) => serverGet(`/api/research/search?q=${encodeURIComponent(String(args?.q ?? ""))}`),
    },
    {
      name: "addPriceWatch",
      description: '把个股加入盯价监控清单（跌到买入区 ±5% 强提示）—— 传 {code,name,buy_low,buy_high,stop_loss?,trigger_pct?}，如 {"code":"600522","name":"中天科技","buy_low":30,"buy_high":32,"stop_loss":27.5}',
      kind: "data",
      execute: async (args: any) => serverPost("/api/watch/add", {
        code: String(args?.code ?? ""), name: String(args?.name ?? ""),
        buy_low: Number(args?.buy_low), buy_high: Number(args?.buy_high),
        stop_loss: args?.stop_loss != null ? Number(args.stop_loss) : null,
        trigger_pct: args?.trigger_pct != null ? Number(args.trigger_pct) : 5,
        note: String(args?.note ?? ""),
      }),
    },
    {
      name: "listWatches",
      description: "查看盯价监控清单：每只的现价/买入区/偏离度%（相对买入区中值）—— 无需参数",
      kind: "data",
      execute: async () => serverGet("/api/watch/list"),
    },
    {
      name: "updatePriceWatch",
      description: '更新/暂停监控 —— 传 {code, status?:"active"|"paused"|"done", buy_low?, buy_high?, stop_loss?, trigger_pct?}',
      kind: "data",
      execute: async (args: any) => serverPost("/api/watch/update", {
        code: String(args?.code ?? ""), status: args?.status ?? null,
        buy_low: args?.buy_low != null ? Number(args.buy_low) : null,
        buy_high: args?.buy_high != null ? Number(args.buy_high) : null,
        stop_loss: args?.stop_loss != null ? Number(args.stop_loss) : null,
        trigger_pct: args?.trigger_pct != null ? Number(args.trigger_pct) : null,
      }),
    },
  ];
}

/** 五段式调研流程 system 注入（AIConsole 引导） */
export const RESEARCH_SYSTEM = `【个股深度调研流程 · stock-deep-research-v2】当用户要求"深度调研/深度分析"某只股票时，按以下五阶段执行（每阶段用对应工具拿真实数据，禁止编造）：
- Phase 0 鹰眼速览：researchQuote 核实代码（防相似代码混淆）+ 最新价/估值/近期涨跌 → 给"第一印象"
- Phase 1 财务骨架：researchData 查财务三表/业绩/现金流 → 财务质量判断
- Phase 2 消息面：researchSearch 查最新研报/公告/新闻 → 机构预期与消息催化
- Phase 3 行业博弈：researchData/researchSearch 查行业对比/景气/风险 → 行业判断
- Phase 4 综合评级：汇总前四阶段 → 三档估值（乐观/合理/悲观）→ 合理目标价区间 → 支撑压力位 → 胜率×赔率 → 评级与建议操作
最后：主动询问是否把结论（买入区/止损位）加入盯价监控（addPriceWatch），并说明可随时 listWatches 查看。`;

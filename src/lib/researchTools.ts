// ============================================================
// v9.66：个股深度调研工具组（供 AIConsole 全站 AI 助手使用）
// 后端能力：server /api/research/*（妙想 mx-data/mx-search 中转）+ /api/watch/*（盯价监控）
// 前端工具：execute 调 server API（Key 只存 server/.env，符合红线）
// 五段式流程（stock-deep-research-v2）：Phase 0 速览 → 1 财务 → 2 消息 → 3 行业 → 4 评级
// v9.67：调研会话状态（researchCtx）—— 结构化多轮上下文（标的/进度/已收集数据），
//   持久化 localStorage，每轮注入 LLM —— "像真人对话一样"记住上下文
// ============================================================
import type { AgentTool } from "./agentTools";
import { STOCK_NAME_MAP } from "./stockNames";

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
      name: "addToRadar",
      description: '把个股加入个股雷达（自选股，上限30）—— 传 {code,name} 如 {"code":"600487","name":"亨通光电"}。与 addPriceWatch 配合：调研完成后先加入雷达再开启盯价监控',
      kind: "data",
      execute: async (args: any) => {
        const code = String(args?.code ?? "").trim();
        const name = String(args?.name ?? "").trim() || code;
        if (!/^\d{6}$/.test(code)) return { ok: false, error: "code 必须为 6 位数字" };
        try {
          const raw = localStorage.getItem("stock_watchlist");
          const codes: string[] = raw ? JSON.parse(raw) : [];
          if (codes.includes(code)) return { ok: true, existed: true, codes };
          if (codes.length >= 30) return { ok: false, error: "自选股已达上限 30 只，请先删除再添加" };
          codes.push(code);
          localStorage.setItem("stock_watchlist", JSON.stringify(codes));
          // 通知已挂载的 StockWatchlist 刷新（监听自定义事件）
          window.dispatchEvent(new CustomEvent("stock-watchlist-changed", { detail: { code, name } }));
          return { ok: true, added: code, name, codes };
        } catch (e) { return { ok: false, error: "加入雷达失败:" + String(e) }; }
      },
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
最后：主动询问是否把结论（买入区/止损位）加入盯价监控（addPriceWatch），并说明可随时 listWatches 查看。
【v9.67 联动】若用户想持续跟踪该股：先 addToRadar 加入个股雷达（自选股），再 addPriceWatch 开启盯价监控（买入区±5%强提示）——两步可一次完成，并在回复中说明已加入。`;

// ============================================================
// v9.67：调研会话状态（researchCtx）—— 让 AIConsole 拥有真正的多轮上下文
// 结构化的"调研到哪了"：标的/进度/已收集数据，持久化 localStorage，每轮注入 LLM。
// 效果：问"继续/深入查询"时，LLM 明确知道在调研哪只票、已到哪个 Phase、已拿到哪些数据，
//       不重头、不串场 —— 达到"像真人对话一样"的上下文理解。
// ============================================================
export interface ResearchCtx {
  code: string;
  name: string;
  phase: number;          // 0-4 已推进到的阶段
  collected: string[];    // 已收集的关键数据点（上限 20 条）
  conclusion: string;     // 最终评级（Phase 4 完成后写入）
  updatedAt: number;
}

const CTX_KEY = "ai_research_ctx";

export function loadResearchCtx(): ResearchCtx | null {
  try {
    const raw = localStorage.getItem(CTX_KEY);
    return raw ? JSON.parse(raw) as ResearchCtx : null;
  } catch { return null; }
}

export function saveResearchCtx(ctx: ResearchCtx | null): void {
  try {
    if (ctx) localStorage.setItem(CTX_KEY, JSON.stringify(ctx));
    else localStorage.removeItem(CTX_KEY);
  } catch { /* 静默 */ }
}

/** 从用户消息提取 6 位股票代码（支持中文名映射，如"亨通光电"→600487） */
export function extractStockCode(text: string): string | null {
  const m = text.match(/\b\d{6}\b/);
  if (m) return m[0];
  for (const [name, code] of Object.entries(STOCK_NAME_MAP)) {
    if (text.includes(name)) return code;
  }
  return null;
}

/** 判断是否"新调研"指令（含深度调研/深度分析/个股深度 + 代码） */
export function isNewResearchRequest(text: string): boolean {
  return /深度调研|深度分析|个股深度|深度研究/.test(text) && extractStockCode(text) != null;
}

/** 判断是否"继续调研"指令（继续/深入/接着/Phase N） */
export function isContinueResearch(text: string): boolean {
  return /继续|深入|接着|Phase\s*[0-4]|第[一二三四五]阶段/.test(text);
}

/** 把会话状态注入用户消息（LLM 每轮都"记得"上下文） */
export function researchCtxNote(ctx: ResearchCtx | null): string {
  if (!ctx) return "";
  const phaseNames = ["速览", "财务", "消息面", "行业", "评级"];
  const phaseName = phaseNames[Math.min(4, Math.max(0, ctx.phase))] ?? "";
  const lines = [
    "【当前调研会话（请严格基于此继续，不要重头开始）】",
    "标的：" + ctx.name + "(" + ctx.code + ")，已推进到 Phase " + ctx.phase + "（" + phaseName + "）",
  ];
  if (ctx.collected.length > 0) {
    lines.push("已收集数据：\n" + ctx.collected.slice(-15).map(s => "· " + s).join("\n"));
  } else {
    lines.push("尚未收集数据");
  }
  if (ctx.conclusion) lines.push("已有评级结论：" + ctx.conclusion);
  lines.push("若用户说\"继续/深入查询\"：从上一条未完成的数据点继续推进；若用户新提不同代码才切换标的。");
  return lines.filter(Boolean).join("\n");
}

/** 调研回复后更新会话状态（追加本轮产出，识别结论） */
export function updateResearchCtxAfterReply(ctx: ResearchCtx | null, reply: string, toolsCalled: string[]): ResearchCtx | null {
  if (!ctx) return null;
  const next: ResearchCtx = { ...ctx, updatedAt: Date.now() };
  const core = reply.replace(/^🔍.*$/m, "").trim().slice(0, 300);
  if (core && !next.collected.includes(core)) {
    next.collected.push(core);
    if (next.collected.length > 20) next.collected = next.collected.slice(-20);
  }
  const hasConclusion = /评级|综合判断|结论|建议操作|可上车|观望|谨慎|胜率|赔率|目标价/.test(reply);
  if (hasConclusion) {
    next.phase = 4;
    next.conclusion = core.slice(0, 200);
  } else if (toolsCalled.length > 0) {
    if (next.phase < 3) next.phase = Math.min(3, next.phase + 1);
  }
  saveResearchCtx(next);
  return next;
}

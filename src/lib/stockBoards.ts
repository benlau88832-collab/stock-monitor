// 个股所属概念（v9.21-B + v9.91.0 概念地基）
// 数据源：东财 datacenter RPT_F10_CORETHEME_BOARDTYPE
// 返回每只股票的"所属板块"列表（含题材概念 + 指数成分 + 地域板块 等）
// 用途：取代"拉概念成分股反查"——每只涨停股直接知道它属于哪些概念（同花顺式）
// v9.91.0（概念地基）：
//   ① 题材判定统一走 src/shared/conceptFilter.js（同花顺白名单 + 宽泛黑名单一票否决 + 词根兜底）
//   ② 白名单从 /api/concepts/whitelist 懒加载（60min 缓存；服务端离线回退旧兜底，渐进降级）
//   ③ 支持 hybk 透传（涨停池行业随概念请求落库服务端）
//   ④ 单次上限 120 → 300（99 涨停 + 自选全覆盖）
// 纯数据层

// ============== 判定核心（与服务端同源，唯一权威） ==============
import { isThemeBoardName as _isThemeBoardName, normalizeConceptName } from "../shared/conceptFilter";

// ============== 同花顺白名单（懒加载） ==============
let whitelistCache: Set<string> | null = null;
let whitelistTs = 0;
const WHITELIST_TTL = 60 * 60 * 1000; // 60min

/** 加载同花顺概念白名单（失败保持 null → 判定回退旧兜底逻辑，不阻塞） */
async function ensureWhitelist(): Promise<Set<string> | null> {
  const now = Date.now();
  if (whitelistCache && now - whitelistTs < WHITELIST_TTL) return whitelistCache;
  try {
    const resp = await fetch(`/api/concepts/whitelist`, { signal: AbortSignal.timeout(8000) });
    if (resp.ok) {
      const json: { concepts?: Array<{ code: string; name: string }> } = await resp.json();
      const names = (json.concepts ?? []).map(x => normalizeConceptName(x.name));
      whitelistCache = new Set(names.filter(Boolean));
      whitelistTs = Date.now();
      console.log(`[conceptFilter] 同花顺概念白名单就绪: ${whitelistCache.size} 个`);
    }
  } catch { /* 服务端不可用 → 保持 null */ }
  return whitelistCache;
}

/** 板块名是否为"真实题材概念"（白名单化判定，与全站唯一核心同口径） */
export function isThemeBoard(name: string): boolean {
  return _isThemeBoardName(name, whitelistCache);
}

// ============== 数据结构 ==============
export interface StockBoards {
  code: string;
  /** 该股所属的全部题材概念名（已过滤非题材） */
  themes: string[];
  /** 全部板块（未过滤，调试用） */
  allBoards: string[];
}

// ============== 批量查询 ==============
const DATACENTER = "https://datacenter-web.eastmoney.com/api/data/v1/get";
import { isLocalServer } from "./cloudStore";

// v9.84（性能根治）：F10 概念查询 —— 按 code 60s 缓存 + 4s 超时。
// 原实现无 AbortSignal：datacenter 挂起时 refreshAll 关键路径（classifyStocksToMainlines 快路径）
// 无限等待 → inFlight 锁死整轮刷新（用户"几乎无法加载"的根因之一）。
// 60s 缓存让同一只股票在同一轮/相邻轮次内不再重复打 datacenter。
// v9.84（分类统一）：本地部署优先走服务端 /api/db/concepts —— PG stock_concepts 持久化，
// 未命中由服务端实时抓取并落库（增量积累，跨刷新/跨会话复用，前端不再重复打东财）
const boardsCache = new Map<string, { data: StockBoards; ts: number }>();
const BOARDS_TTL = 60 * 1000;

/**
 * 批量查询多只股票的所属概念（一次 IN 查询，最多 300 只）
 * @param codes 股票代码（如 ["002896","002230"]）
 * @param hybkMap 可选：code→东财行业（涨停池自带，随请求落库服务端，补全 hybk 字段）
 */
export async function fetchStocksBoards(codes: string[], hybkMap?: Map<string, string>): Promise<Map<string, StockBoards>> {
  const result = new Map<string, StockBoards>();
  if (codes.length === 0) return result;

  // 本地部署 → 服务端持久化查询（含未命中抓取落库）
  if (isLocalServer()) {
    try {
      await ensureWhitelist(); // 白名单先就绪（失败不阻塞，回退旧兜底）
      const hybkQ = hybkMap && hybkMap.size > 0
        ? "&hybk=" + encodeURIComponent([...hybkMap.entries()].map(([c, h]) => `${c}:${h}`).join(","))
        : "";
      const resp = await fetch(`/api/db/concepts?codes=${encodeURIComponent(codes.slice(0, 300).join(","))}${hybkQ}`, { signal: AbortSignal.timeout(8000) });
      if (resp.ok) {
        const json: Record<string, { themes?: string[]; allBoards?: string[] }> = await resp.json();
        const now = Date.now();
        for (const [code, v] of Object.entries(json)) {
          const sb: StockBoards = { code, themes: v.themes ?? [], allBoards: v.allBoards ?? [] };
          result.set(code, sb);
          boardsCache.set(code, { data: sb, ts: now });
        }
        return result;
      }
    } catch { /* 服务端不可用 → 回退浏览器直连 */ }
  }

  // 命中缓存直接返回（按 code 粒度，跨调用方共享）
  const now = Date.now();
  const miss: string[] = [];
  for (const c of codes) {
    const hit = boardsCache.get(c);
    if (hit && now - hit.ts < BOARDS_TTL) result.set(c, hit.data);
    else miss.push(c);
  }
  if (miss.length === 0) return result;

  // 分块：每批 30 只；v9.84：各块**并行**（datacenter 独立域名，不受 jsonpQueue 并发3约束，
  // 串行 6 块 × 4s = 24s 最坏；并行总耗时 = 单块耗时 ≤4s）
  const chunks: string[][] = [];
  for (let i = 0; i < miss.length; i += 30) chunks.push(miss.slice(i, i + 30));

  await Promise.allSettled(chunks.map(async (chunk) => {
    const codeList = chunk.map(c => `"${c}"`).join(",");
    // v9.26.17：pageSize 5000（30 只/批 × 多板块可能 > 500；避免尾部股概念被静默截断）
    const url = `${DATACENTER}?reportName=RPT_F10_CORETHEME_BOARDTYPE&columns=ALL&filter=(SECURITY_CODE%20in%20(${encodeURIComponent(codeList).replace(/%22/g, '"')}))&pageSize=5000&source=HSF10&client=WEB`;
    try {
      // v9.84：补 4s 超时（datacenter 挂起不再无限等）
      const resp = await fetch(url, { headers: { Referer: "https://emweb.securities.eastmoney.com/" }, signal: AbortSignal.timeout(4000) });
      const json = await resp.json();
      const data: any[] = json?.result?.data ?? [];
      // 按 code 聚合
      const byCode = new Map<string, string[]>();
      for (const item of data) {
        const code = String(item.SECURITY_CODE ?? "");
        const board = String(item.BOARD_NAME ?? "");
        if (!code || !board) continue;
        if (!byCode.has(code)) byCode.set(code, []);
        byCode.get(code)!.push(board);
      }
      for (const code of chunk) {
        const allBoards = byCode.get(code) ?? [];
        const themes = allBoards.filter(isThemeBoard);
        const sb: StockBoards = { code, themes, allBoards };
        result.set(code, sb);
        boardsCache.set(code, { data: sb, ts: now });
      }
    } catch (e) {
      console.warn(`[fetchStocksBoards] 查询失败 chunk=${chunk.length}只:`, e);
    }
  }));
  return result;
}

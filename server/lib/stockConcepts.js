// ============================================================
// 个股所属概念持久化（v9.84 分类统一 + v9.91.0 概念地基）
// 数据源：东财 datacenter RPT_F10_CORETHEME_BOARDTYPE（与前端 stockBoards.ts 同构）
// 职责：GET /api/db/concepts?codes= 时查 PG stock_concepts 表；
//       未命中的 code 实时抓东财并落库（增量积累，避免每次刷新重复打东财）
// v9.91.0（概念地基）：
//   ① 题材判定与前端统一走 src/shared/conceptFilter.js（同花顺白名单 + 宽泛黑名单一票否决 + 词根兜底）
//   ② INSERT 补写 hybk 字段（此前漏写 → 单股全景 hybk 恒 null）
//   ③ 东财抓取失败 chunk 补空条目落库（防每次刷新重复打东财）
//   ④ codes 上限 120 → 300（99 只涨停 + 自选全部覆盖）
// ============================================================
const DATACENTER = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const { getJson } = require("./outbound");
// v9.91.0：全站唯一判定核心（纯 ESM，require(ESM) Node 22+）
const { isThemeBoardName, normalizeConceptName } = require("../../src/shared/conceptFilter.js");
const { getConceptWhitelist } = require("./thsConcepts");

/** 按 code 批量抓东财概念（30 只/批，并行分块，4s 超时） */
async function fetchEastmoneyBoards(codes, whitelist = null) {
  const result = new Map(); // code -> { themes, allBoards }
  const chunks = [];
  for (let i = 0; i < codes.length; i += 30) chunks.push(codes.slice(i, i + 30));
  await Promise.allSettled(chunks.map(async (chunk) => {
    const codeList = chunk.map(c => `"${c}"`).join(",");
    const url = `${DATACENTER}?reportName=RPT_F10_CORETHEME_BOARDTYPE&columns=ALL&filter=(SECURITY_CODE%20in%20(${encodeURIComponent(codeList).replace(/%22/g, '"')}))&pageSize=5000&source=HSF10&client=WEB`;
    try {
      // v9.86.0（P2-7）：统一出站客户端（hostGuard + 错误分类；4s 超时语义不变）
      const r = await getJson(url, { timeout: 4000, headers: { Referer: "https://emweb.securities.eastmoney.com/" }, source: "datacenter" });
      const data = r.data?.result?.data ?? [];
      const byCode = new Map();
      for (const item of data) {
        const code = String(item.SECURITY_CODE ?? "");
        const board = String(item.BOARD_NAME ?? "");
        if (!code || !board) continue;
        if (!byCode.has(code)) byCode.set(code, []);
        byCode.get(code).push(board);
      }
      for (const code of chunk) {
        const allBoards = byCode.get(code) ?? [];
        const themes = allBoards.filter(b => isThemeBoardName(b, whitelist));
        result.set(code, { themes, allBoards });
      }
    } catch (e) {
      // v9.91.0：失败 chunk 补空条目（调用方落库 → 防每轮刷新重复打东财）
      console.warn(`[stockConcepts] 东财抓取失败 chunk=${chunk.length}只:`, e.message);
      for (const code of chunk) result.set(code, { themes: [], allBoards: [], empty: true });
    }
  }));
  return result;
}

/** 查库 + 实时补抓 + 落库（GET /api/db/concepts 核心） */
async function getConcepts(pool, codes, hybkMap = null) {
  const out = {};
  if (!Array.isArray(codes) || codes.length === 0) return out;
  const unique = [...new Set(codes.map(c => String(c).trim()).filter(Boolean))].slice(0, 300);
  if (unique.length === 0) return out;

  // v9.91.0：同花顺白名单（判定核心的权威数据源；抓取失败为 null → 判定回退旧兜底逻辑）
  let whitelist = null;
  try {
    const list = await getConceptWhitelist(pool);
    if (list.length > 0) whitelist = new Set(list.map(x => normalizeConceptName(x.name)));
  } catch { /* 表不可用 → 回退 */ }

  // 1. 查库（命中直接返回；v9.91.0：命中但请求带 hybk 且库中缺失 → 顺带补写）
  const dbR = await pool.query(
    "SELECT code, concepts, all_boards, hybk FROM stock_concepts WHERE code = ANY($1)",
    [unique],
  );
  const hit = new Set();
  for (const row of dbR.rows) {
    hit.add(row.code);
    out[row.code] = { themes: row.concepts ?? [], allBoards: row.all_boards ?? [], hybk: row.hybk ?? null, cached: true };
    const reqHybk = hybkMap?.get(row.code);
    if (reqHybk && !row.hybk) {
      try {
        await pool.query("UPDATE stock_concepts SET hybk=$2, updated_at=now() WHERE code=$1", [row.code, reqHybk]);
        out[row.code] = { ...out[row.code], hybk: reqHybk };
      } catch (e) { console.warn("[stockConcepts] hybk 补写失败:", e.message); }
    }
  }

  // 2. 未命中 → 实时抓东财 + 落库（增量积累）
  const miss = unique.filter(c => !hit.has(c));
  if (miss.length > 0) {
    const fetched = await fetchEastmoneyBoards(miss, whitelist);
    for (const [code, sb] of fetched) {
      const hybk = hybkMap?.get(code) ?? null;
      out[code] = { themes: sb.themes, allBoards: sb.allBoards, hybk, cached: false };
      try {
        // v9.91.0：INSERT 补写 hybk（原漏写 → 单股全景行业恒空）
        await pool.query(
          `INSERT INTO stock_concepts(code, concepts, all_boards, hybk, updated_at)
           VALUES($1,$2,$3,$4,now())
           ON CONFLICT(code) DO UPDATE SET concepts=$2, all_boards=$3, hybk=COALESCE($4, stock_concepts.hybk), updated_at=now()`,
          [code, JSON.stringify(sb.themes), JSON.stringify(sb.allBoards), hybk],
        );
      } catch (e) { console.warn("[stockConcepts] 落库失败:", e.message); }
    }
  }
  return out;
}

module.exports = { getConcepts, fetchEastmoneyBoards };

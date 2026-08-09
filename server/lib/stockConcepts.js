// ============================================================
// 个股所属概念持久化（v9.84 分类统一）
// 数据源：东财 datacenter RPT_F10_CORETHEME_BOARDTYPE（与前端 stockBoards.ts 同构）
// 职责：GET /api/db/concepts?codes= 时查 PG stock_concepts 表；
//       未命中的 code 实时抓东财并落库（增量积累，避免每次刷新重复打东财）
// ============================================================
const DATACENTER = "https://datacenter-web.eastmoney.com/api/data/v1/get";

/** 非题材过滤（与前端 stockBoards.ts isThemeBoard 同构的简化版：仅过滤指数/地域/状态类） */
const NON_THEME = /沪深300|上证50|中证|创业板指|深证|上证180|深证100|科创50|国证|MSCI|富时|标普|罗素|央视50|融资融券|深股通|沪股通|北向资金|北交所|陆股通|板块$|概念$|新股|次新|昨日|最近|活跃|热门|强势|预盈|预亏|高送转|破净|低价股|ST|振幅|换手|量比|缩量|放量|超大单|大单|中单|小单|净流入|净流出|资金流入|资金流出|增仓|减仓|封板|炸板|跌停|涨停|高开|低开|东方财富|同花顺|成分|权重|样本/;

function isThemeBoard(name) {
  if (!name || name.length === 0) return false;
  if (NON_THEME.test(name)) return false;
  // 至少要有题材含义：长度 ≤8 的非指数名（简化口径，前端有更全词根表）
  return name.length <= 8;
}

/** 按 code 批量抓东财概念（30 只/批，并行分块，4s 超时） */
async function fetchEastmoneyBoards(codes) {
  const result = new Map(); // code -> { themes, allBoards }
  const chunks = [];
  for (let i = 0; i < codes.length; i += 30) chunks.push(codes.slice(i, i + 30));
  await Promise.allSettled(chunks.map(async (chunk) => {
    const codeList = chunk.map(c => `"${c}"`).join(",");
    const url = `${DATACENTER}?reportName=RPT_F10_CORETHEME_BOARDTYPE&columns=ALL&filter=(SECURITY_CODE%20in%20(${encodeURIComponent(codeList).replace(/%22/g, '"')}))&pageSize=5000&source=HSF10&client=WEB`;
    try {
      const resp = await fetch(url, {
        headers: { Referer: "https://emweb.securities.eastmoney.com/" },
        signal: AbortSignal.timeout(4000),
      });
      const json = await resp.json();
      const data = json?.result?.data ?? [];
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
        result.set(code, { themes: allBoards.filter(isThemeBoard), allBoards });
      }
    } catch (e) {
      console.warn(`[stockConcepts] 东财抓取失败 chunk=${chunk.length}只:`, e.message);
    }
  }));
  return result;
}

/** 查库 + 实时补抓 + 落库（GET /api/db/concepts 核心） */
async function getConcepts(pool, codes) {
  const out = {};
  if (!Array.isArray(codes) || codes.length === 0) return out;
  const unique = [...new Set(codes.map(c => String(c).trim()).filter(Boolean))].slice(0, 120);
  if (unique.length === 0) return out;

  // 1. 查库（命中直接返回）
  const dbR = await pool.query(
    "SELECT code, concepts, all_boards, hybk FROM stock_concepts WHERE code = ANY($1)",
    [unique],
  );
  const hit = new Set();
  for (const row of dbR.rows) {
    hit.add(row.code);
    out[row.code] = { themes: row.concepts ?? [], allBoards: row.all_boards ?? [], hybk: row.hybk ?? null, cached: true };
  }

  // 2. 未命中 → 实时抓东财 + 落库（增量积累）
  const miss = unique.filter(c => !hit.has(c));
  if (miss.length > 0) {
    const fetched = await fetchEastmoneyBoards(miss);
    for (const [code, sb] of fetched) {
      out[code] = { themes: sb.themes, allBoards: sb.allBoards, hybk: null, cached: false };
      try {
        await pool.query(
          `INSERT INTO stock_concepts(code, concepts, all_boards, updated_at)
           VALUES($1,$2,$3,now())
           ON CONFLICT(code) DO UPDATE SET concepts=$2, all_boards=$3, updated_at=now()`,
          [code, JSON.stringify(sb.themes), JSON.stringify(sb.allBoards)],
        );
      } catch (e) { console.warn("[stockConcepts] 落库失败:", e.message); }
    }
  }
  return out;
}

module.exports = { getConcepts, fetchEastmoneyBoards };

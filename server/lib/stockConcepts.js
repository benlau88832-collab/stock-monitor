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

/** 按 code 批量抓东财概念（30 只/批，并行分块，4s 超时）
 *  v9.91.2（概念机制根治）：解析 IS_PRECISE（核心题材标记）+ BOARD_RANK（板块类别层级序号），
 *  core_concept = 通过题材判定且 IS_PRECISE=1 的板块中 BOARD_RANK 最小的一个（东财权威主概念，
 *  不再靠自建词根投票猜主概念——"氢能源/华为昇腾"抢票问题从此数据驱动解决） */
async function fetchEastmoneyBoards(codes, whitelist = null) {
  const result = new Map(); // code -> { themes, allBoards, coreConcept }
  const chunks = [];
  for (let i = 0; i < codes.length; i += 30) chunks.push(codes.slice(i, i + 30));
  await Promise.allSettled(chunks.map(async (chunk) => {
    const codeList = chunk.map(c => `"${c}"`).join(",");
    const url = `${DATACENTER}?reportName=RPT_F10_CORETHEME_BOARDTYPE&columns=ALL&filter=(SECURITY_CODE%20in%20(${encodeURIComponent(codeList).replace(/%22/g, '"')}))&pageSize=5000&source=HSF10&client=WEB`;
    try {
      // v9.86.0（P2-7）：统一出站客户端（hostGuard + 错误分类；4s 超时语义不变）
      const r = await getJson(url, { timeout: 4000, headers: { Referer: "https://emweb.securities.eastmoney.com/" }, source: "datacenter" });
      const data = r.data?.result?.data ?? [];
      const byCode = new Map(); // code -> [{name, rank, precise}]
      for (const item of data) {
        const code = String(item.SECURITY_CODE ?? "");
        const board = String(item.BOARD_NAME ?? "");
        if (!code || !board) continue;
        if (!byCode.has(code)) byCode.set(code, []);
        byCode.get(code).push({
          name: board,
          rank: Number(item.BOARD_RANK) || 999,
          precise: item.IS_PRECISE === 1 || item.IS_PRECISE === "1" || item.IS_PRECISE === true,
          // v9.91.2：入选理由（"参股公司…"=蹭概念，"控股子公司…产品"=核心主营，用于核心题材分层）
          reason: String(item.SELECTED_BOARD_REASON ?? ""),
        });
      }
      for (const code of chunk) {
        const rows = byCode.get(code) ?? [];
        const allBoards = rows.map(x => x.name);
        const themes = allBoards.filter(b => isThemeBoardName(b, whitelist));
        // v9.91.2：核心题材 = 题材判定通过 + IS_PRECISE=1 中 BOARD_RANK 最小者；
        //   按 SELECTED_BOARD_REASON 语义分层 —— 含"参股/持股/战略合作"（蹭概念，如
        //   "参股公司全诊医学与华为昇腾合作"）降级到后排，主营语义（控股/产品/业务）优先。
        //   创新医疗实测：DeepSeek概念(参股→弱) vs 人脑工程(控股子公司脑机接口→核心) → 人脑工程胜出
        const preciseThemes = rows
          .filter(x => x.precise && isThemeBoardName(x.name, whitelist))
          .map(x => ({
            ...x,
            weak: /参股|持股|战略合作|拟入股|间接入股/.test(x.reason ?? ""),
          }))
          .sort((a, b) => {
            if (a.weak !== b.weak) return a.weak ? 1 : -1; // 蹭概念一律后置
            return a.rank - b.rank;
          });
        const coreConcept = preciseThemes[0]?.name ?? null;
        result.set(code, { themes, allBoards, coreConcept });
      }
    } catch (e) {
      // v9.91.0：失败 chunk 补空条目（调用方落库 → 防每轮刷新重复打东财）
      console.warn(`[stockConcepts] 东财抓取失败 chunk=${chunk.length}只:`, e.message);
      for (const code of chunk) result.set(code, { themes: [], allBoards: [], coreConcept: null, empty: true });
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
    "SELECT code, concepts, all_boards, hybk, core_concept FROM stock_concepts WHERE code = ANY($1)",
    [unique],
  );
  const hit = new Set();
  for (const row of dbR.rows) {
    hit.add(row.code);
    out[row.code] = {
      themes: row.concepts ?? [], allBoards: row.all_boards ?? [],
      hybk: row.hybk ?? null, coreConcept: row.core_concept ?? null, cached: true,
    };
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
      out[code] = { themes: sb.themes, allBoards: sb.allBoards, hybk, coreConcept: sb.coreConcept ?? null, cached: false };
      try {
        // v9.91.0：INSERT 补写 hybk（原漏写 → 单股全景行业恒空）
        // v9.91.2：补写 core_concept（东财权威核心题材）
        await pool.query(
          `INSERT INTO stock_concepts(code, concepts, all_boards, hybk, core_concept, updated_at)
           VALUES($1,$2,$3,$4,$5,now())
           ON CONFLICT(code) DO UPDATE SET concepts=$2, all_boards=$3, hybk=COALESCE($4, stock_concepts.hybk),
             core_concept=COALESCE($5, stock_concepts.core_concept), updated_at=now()`,
          [code, JSON.stringify(sb.themes), JSON.stringify(sb.allBoards), hybk, sb.coreConcept ?? null],
        );
      } catch (e) { console.warn("[stockConcepts] 落库失败:", e.message); }
    }
  }
  return out;
}

module.exports = { getConcepts, fetchEastmoneyBoards };

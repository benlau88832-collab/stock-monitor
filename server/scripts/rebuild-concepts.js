// ============================================================
// v9.91.0（概念地基）+ v9.91.2（概念机制根治）：存量 stock_concepts 数据重建
// 用法：node server/scripts/rebuild-concepts.js
// 逻辑：全量重抓东财 F10（30只/批并行，4s 超时）→
//   ① themes 用全站唯一判定核心重算（宽泛黑名单 + 同花顺白名单 + 词根）
//   ② core_concept = 东财权威核心题材（IS_PRECISE=1 且 BOARD_RANK 最小）—— 数据驱动不靠词根投票
// 背景：v9.90 及以前旧判定落库脏概念（央国企改革/AB股等）；v9.91.1 只删不加（储能概念漏删补不回）；
//       v9.91.2 全量重抓一次性根治（themes + core_concept 全部对齐当前判定）
// ============================================================
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { pool } = require("../db");
const { fetchEastmoneyBoards } = require("../lib/stockConcepts");
const { getConceptWhitelist } = require("../lib/thsConcepts");
const { normalizeConceptName } = require("../../src/shared/conceptFilter.js");

(async () => {
  // 白名单（判定核心数据源；抓取失败为空 → 判定回退词根+宽泛黑名单，仍能清掉脏概念）
  let wl = null;
  try {
    const list = await getConceptWhitelist(pool);
    if (list.length > 0) wl = new Set(list.map(x => normalizeConceptName(x.name)));
    console.log(`白名单: ${wl?.size ?? 0} 个（${wl ? "已加载" : "回退词根判定"}）`);
  } catch (e) { console.warn("白名单加载失败，用词根判定:", e.message); }

  const r = await pool.query("SELECT code FROM stock_concepts");
  const codes = r.rows.map(x => x.code);
  console.log(`全量重抓 ${codes.length} 只...`);

  // 全量重抓（30只/批并行，含 IS_PRECISE/BOARD_RANK → core_concept）
  const fetched = await fetchEastmoneyBoards(codes, wl);
  let changed = 0, total = 0;
  for (const code of codes) {
    const sb = fetched.get(code);
    if (!sb) continue;
    total++;
    const themes = sb.themes ?? [];
    const allBoards = sb.allBoards ?? [];
    const coreConcept = sb.coreConcept ?? null;
    const up = await pool.query(
      `UPDATE stock_concepts SET concepts=$2, all_boards=$3, core_concept=$4, updated_at=now() WHERE code=$1
       RETURNING concepts`,
      [code, JSON.stringify(themes), JSON.stringify(allBoards), coreConcept],
    );
    if (up.rows.length) changed++;
  }
  console.log(`重建完成: 共 ${total} 条，全部更新（themes 当前判定重算 + core_concept 权威核心题材落库）`);
  await pool.end();
  process.exit(0);
})().catch(e => { console.error("重建失败:", e); process.exit(1); });

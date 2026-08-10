// ============================================================
// v9.91.0（概念地基）：存量 stock_concepts 数据重建
// 背景：v9.90 及以前用旧判定（无宽泛黑名单，"央国企改革/AB股/高市净率"等脏概念已落库）
// 用法：node server/scripts/rebuild-concepts.js
// 逻辑：全量读取 → 用全站唯一判定核心（同花顺白名单 + 宽泛黑名单）重过滤 themes → UPDATE
// ============================================================
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { pool } = require("../db");
const { getConceptWhitelist } = require("../lib/thsConcepts");
const { isThemeBoardName, normalizeConceptName } = require("../../src/shared/conceptFilter.js");

(async () => {
  // 白名单（判定核心数据源；抓取失败为空 → 判定回退词根+宽泛黑名单，仍能清掉脏概念）
  let wl = null;
  try {
    const list = await getConceptWhitelist(pool);
    if (list.length > 0) wl = new Set(list.map(x => normalizeConceptName(x.name)));
    console.log(`白名单: ${wl?.size ?? 0} 个（${wl ? "已加载" : "回退词根判定"}）`);
  } catch (e) { console.warn("白名单加载失败，用词根判定:", e.message); }

  const r = await pool.query("SELECT code, concepts, all_boards FROM stock_concepts");
  let changed = 0, total = 0;
  for (const row of r.rows) {
    total++;
    const themes = (row.concepts ?? []).filter(b => isThemeBoardName(b, wl));
    if (JSON.stringify(themes) !== JSON.stringify(row.concepts ?? [])) {
      await pool.query("UPDATE stock_concepts SET concepts=$2, updated_at=now() WHERE code=$1",
        [row.code, JSON.stringify(themes)]);
      changed++;
    }
  }
  console.log(`重建完成: 共 ${total} 条，更新 ${changed} 条（脏概念已清理）`);
  await pool.end();
  process.exit(0);
})().catch(e => { console.error("重建失败:", e); process.exit(1); });

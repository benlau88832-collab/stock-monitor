// ============================================================
// v9.91.2（概念机制根治·防再犯）：概念审计脚本
// v9.91.3（数据源统一）：白名单/审计数据源全部为东财 504（同花顺体系已移除）
// 用法：node server/scripts/audit-concepts.js
// 功能：① 拉取东财 504 概念板块全量（push2delay）
//       ② 全量跑 isThemeBoardName → 拒绝清单（含原因分类）
//       ③ 保留概念跑 conceptGroupOf → 折叠覆盖报告（归不到组的=防流失重点，如"人脑工程"上次漏配）
// 每次改动 conceptFilter/concept-groups 后必跑，防概念静默流失/漏网。
// ============================================================
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { getJson } = require("../lib/outbound");
const { isThemeBoardName, isBroadConcept } = require("../../src/shared/conceptFilter.js");

const CLIST = "https://push2delay.eastmoney.com/api/qt/clist/get";

/** 拉东财全部概念板块名（6 页 × 100） */
async function fetchEastmoneyConcepts() {
  const names = new Set();
  for (let pn = 1; pn <= 6; pn++) {
    const url = `${CLIST}?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12&fs=m:90+t:3&fields=f12,f14`;
    const r = await getJson(url, { timeout: 6000, source: "push2delay" });
    const rows = r.data?.data?.diff ?? [];
    for (const row of rows) {
      const n = String(row.f14 ?? "").trim();
      if (n) names.add(n);
    }
    if (rows.length < 100) break;
  }
  return [...names];
}

(async () => {
  // ① 概念全集：东财 504（v9.91.3 唯一数据源，同花顺体系已移除）
  let emNames = [];
  try {
    emNames = await fetchEastmoneyConcepts();
    console.log(`东财概念拉取: ${emNames.length} 个`);
  } catch (e) {
    console.warn(`东财拉取失败: ${e.message}`);
    process.exit(1);
  }
  const all = emNames.sort();
  console.log(`审计概念总数: ${all.length}\n`);

  // ② 判定分类
  const rejected = [];   // { name, reason }
  const accepted = [];
  for (const n of all) {
    if (isBroadConcept(n)) rejected.push({ name: n, reason: "广泛概念" });
    else if (!isThemeBoardName(n, null)) {
      rejected.push({ name: n, reason: "白名单外+无词根" });
    } else accepted.push(n);
  }

  console.log(`=== 拒绝 ${rejected.length} 个 ===`);
  for (const r of rejected) console.log(`  [${r.reason}] ${r.name}`);
  console.log();

  // ③ 折叠覆盖审计（保留概念中归不到任何词根组的 = 防流失重点）
  let uncoveredCount = 0;
  console.log(`=== 保留 ${accepted.length} 个 · 折叠覆盖审计 ===`);
  // conceptGroupOf 是前端 TS，这里用 concept-groups.js 的等效匹配（最长词根优先，简化版）
  const groups = require("../../src/shared/concept-groups.js").CONCEPT_GROUPS;
  const rootsAll = groups.flatMap(g => g.roots.map(r => ({ root: r, group: g.group })));
  for (const n of accepted) {
    const hits = rootsAll.filter(({ root }) => n.includes(root));
    const best = hits.length ? hits.sort((a, b) => b.root.length - a.root.length)[0] : null;
    if (!best) {
      uncoveredCount++;
      console.log(`  ⚠ 折叠覆盖缺失: ${n}`);
    }
  }
  console.log(`\n折叠覆盖缺失 ${uncoveredCount}/${accepted.length}（0=全部可归组，>0 需在 concept-groups.js 补词根）`);
  process.exit(0);
})().catch(e => { console.error("审计失败:", e); process.exit(1); });

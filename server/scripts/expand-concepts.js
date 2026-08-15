// ============================================================
// server/scripts/expand-concepts.js —— B8 概念范围采集（v9.149.1）
// 目的：stock_concepts 从"按需采集 414 只"扩到"6 链相关概念全量成分股"，
//       提升异动监控覆盖与受益人白名单质量。
// 流程：
//   1. 拉东财概念板块列表（fs=m:90+t:3）→ 匹配 6 链相关概念名（CHAINS.concepts 关键词）
//   2. 对每个匹配板块拉成分股（clist fs=b:BKxxxx，pz=500）→ 全量代码去重
//   3. fetchEastmoneyBoards 分批抓 F10 概念数据 → 落库 stock_concepts（ON CONFLICT 幂等）
// 用法：node server/scripts/expand-concepts.js [--dry-run]
// ============================================================
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { pool } = require("../db");
const { getJson } = require("../lib/outbound");
const { fetchEastmoneyBoards } = require("../lib/stockConcepts");
const { CHAINS } = require("../lib/chainStocks");
const { getConceptWhitelist } = require("../lib/thsConcepts");
const { normalizeConceptName } = require("../../src/shared/conceptFilter.js");

const DRY_RUN = process.argv.includes("--dry-run");
const CLIST = "https://push2.eastmoney.com/api/qt/clist/get";

async function fetchAllPages(url, maxPages = 15) {
  const all = [];
  for (let pn = 1; pn <= maxPages; pn++) {
    const u = url.replace("{pn}", pn);
    // push2 间歇封禁 → push2delay 兜底（数据同源）
    let r = null;
    try {
      r = await getJson(u, { timeout: 8000, retries: 1, source: "push2" });
    } catch {
      r = await getJson(u.replace("push2.eastmoney.com", "push2delay.eastmoney.com"), { timeout: 8000, retries: 1, source: "push2delay" });
    }
    const diff = r.data?.data?.diff ?? [];
    if (!Array.isArray(diff) || diff.length === 0) break;
    all.push(...diff);
    if (diff.length < 100) break; // 接口单页上限 100，不足整页 = 最后一页
  }
  return all;
}

(async () => {
  const t0 = Date.now();
  // 1. 概念板块列表
  const boards = await fetchAllPages(
    `${CLIST}?pn={pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:3&fields=f12,f14`,
  );
  console.log(`概念板块总数: ${boards.length}`);
  // 匹配 6 链相关概念（关键词来自 CHAINS.concepts + 补充词根）
  const kw = new Set();
  for (const cfg of Object.values(CHAINS)) cfg.concepts.forEach((c) => kw.add(c));
  for (const extra of ["芯片", "存储", "算力", "数据中心", "液冷", "PCB", "CPO", "光模块", "服务器",
    "铜缆", "电力设备", "电网", "特高压", "变压器", "黄金", "有色", "工业金属", "小金属", "稀土",
    "锑", "钨", "钼", "机器人", "人形", "减速器", "传感器", "执行器", "半导体"]) kw.add(extra);
  const matched = boards.filter((b) => [...kw].some((k) => String(b.f14).includes(k)));
  console.log(`匹配概念板块: ${matched.length} 个`);
  matched.forEach((b) => console.log(`  ${b.f12} ${b.f14}`));

  // 2. 成分股全量
  const codes = new Set();
  for (const b of matched) {
    try {
      const members = await fetchAllPages(`${CLIST}?pn={pn}&pz=500&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:${b.f12}&fields=f12`);
      members.forEach((m) => codes.add(String(m.f12)));
      console.log(`  ${b.f14}: ${members.length} 只`);
    } catch (e) {
      console.warn(`  ${b.f14} 成分股拉取失败: ${e.message}`);
    }
  }
  console.log(`去重后总代码数: ${codes.size}`);

  // 3. 只抓库中缺失的（增量）
  const all = [...codes];
  const dbR = await pool.query("SELECT code FROM stock_concepts WHERE code = ANY($1)", [all]);
  const have = new Set(dbR.rows.map((r) => r.code));
  const miss = all.filter((c) => !have.has(c));
  console.log(`库中已有: ${have.size}，需新抓: ${miss.length}`);
  if (DRY_RUN || miss.length === 0) {
    console.log(DRY_RUN ? "dry-run：不落库" : "无新增");
    await pool.end();
    return;
  }

  // 4. 白名单 + 分批抓取落库
  let whitelist = null;
  try {
    const list = await getConceptWhitelist(pool);
    if (list.length > 0) whitelist = new Set(list.map((x) => normalizeConceptName(x.name)));
  } catch { /* 回退 */ }
  let inserted = 0;
  for (let i = 0; i < miss.length; i += 30) {
    const chunk = miss.slice(i, i + 30);
    const fetched = await fetchEastmoneyBoards(chunk, whitelist);
    for (const [code, sb] of fetched) {
      try {
        await pool.query(
          `INSERT INTO stock_concepts(code, concepts, all_boards, hybk, core_concept, updated_at)
           VALUES($1,$2,$3,NULL,$4,now())
           ON CONFLICT(code) DO UPDATE SET concepts=$2, all_boards=$3,
             core_concept=COALESCE($4, stock_concepts.core_concept), updated_at=now()`,
          [code, JSON.stringify(sb.themes), JSON.stringify(sb.allBoards), sb.coreConcept ?? null],
        );
        inserted++;
      } catch (e) { console.warn(`落库失败 ${code}:`, e.message); }
    }
    console.log(`  批次 ${Math.floor(i / 30) + 1}/${Math.ceil(miss.length / 30)} 完成（累计 ${inserted}）`);
  }
  console.log(`采集完成: 新增 ${inserted} 只，总耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await pool.end();
})().catch((e) => { console.error("脚本失败:", e); process.exit(1); });

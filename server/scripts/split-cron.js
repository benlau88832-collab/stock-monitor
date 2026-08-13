// ============================================================
// split-cron.js —— v9.139.0 阶段二 #16 cron.js 按领域拆模块（一次性迁移工具）
// 用法: node split-cron.js   （在 server/ 下执行）
// 原理：读取 server/cron.js，按函数声明 + 花括号配对（字符串/注释/模板感知）切出
//       每个顶层函数的精确行区间，按 DOMAIN 表分组写入 server/cron/<domain>.js，
//       cron.js 只保留：头部 require + startCron（全部调度注册）+ module.exports。
// 附带修复：markCronStep/hasCronStep 原引用模块级未定义 pool（try/catch 吞掉
//           ReferenceError → checkpoint 从未落库）—— 迁移时改为显式 pool 参数。
// 安全网：每个产物文件跑 node --check 语法校验；迁移后 cron.js 可 require 加载。
// ============================================================
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const FILE = path.join(__dirname, "..", "cron.js");
const OUT_DIR = path.join(__dirname, "..", "cron");
const src = fs.readFileSync(FILE, "utf8");
const lines = src.split("\n");
const N = lines.length;

// ---------------- 词法扫描器：花括号事件流（字符串/注释/模板感知） ----------------
function scanBraces() {
  const events = [];
  let depth = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === "'" || c === '"') { const q = c; i++; while (i < src.length) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === q) { i++; break; } if (src[i] === "\n") break; i++; } continue; }
    if (c === "`") {
      i++; let interp = 0;
      while (i < src.length) {
        const t = src[i];
        if (t === "\\") { i += 2; continue; }
        if (interp === 0 && t === "`") { i++; break; }
        if (t === "$" && src[i + 1] === "{") { interp++; i += 2; continue; }
        if (interp > 0 && t === "}") { interp--; i++; continue; }
        if (interp > 0 && (t === "'" || t === '"')) { const q = t; i++; while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; } i++; continue; }
        i++;
      }
      continue;
    }
    if (c === "{") { depth++; events.push({ t: "open", line: src.slice(0, i).split("\n").length }); i++; continue; }
    if (c === "}") { depth--; events.push({ t: "close", line: src.slice(0, i).split("\n").length }); i++; continue; }
    i++;
  }
  if (depth !== 0) throw new Error(`brace mismatch: depth=${depth}`);
  return events;
}

const DECL_RE = /^(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const DECL_MID_RE = /^}\s*(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;

// ---------------- 顶层函数定位 + 函数体配对 ----------------
function findFunctionsWithBodies() {
  const decls = [];
  for (let li = 0; li < N; li++) {
    const m = lines[li].match(DECL_RE) || lines[li].match(DECL_MID_RE);
    if (m) decls.push({ name: m[2], declLine: li + 1, midLine: lines[li].startsWith("}") });
  }
  const events = scanBraces();
  // 栈配对
  const match = new Array(events.length).fill(-1);
  const stack = [];
  for (let ei = 0; ei < events.length; ei++) {
    if (events[ei].t === "open") stack.push(ei);
    else { const oi = stack.pop(); if (oi !== undefined) { match[oi] = ei; match[ei] = oi; } }
  }
  const opensByLine = new Map();
  for (let ei = 0; ei < events.length; ei++) {
    if (events[ei].t === "open") {
      if (!opensByLine.has(events[ei].line)) opensByLine.set(events[ei].line, []);
      opensByLine.get(events[ei].line).push(ei);
    }
  }
  const result = [];
  for (const d of decls) {
    const cands = (opensByLine.get(d.declLine) ?? []).filter(oi => match[oi] !== -1);
    if (cands.length === 0) { console.warn(`!! ${d.name}: 声明行 ${d.declLine} 无 body open`); continue; }
    // body open = 配对 close 最晚的那个 open（最外层）
    let best = cands[0];
    for (const oi of cands) if (events[match[oi]].line > events[match[best]].line) best = oi;
    result.push({ name: d.name, declLine: d.declLine, midLine: d.midLine, endLine: events[match[best]].line });
  }
  return result;
}

// ---------------- 领域分组 ----------------
const DOMAIN = {
  contentKey: "base", httpsGet: "base", bjDate: "base", bjDateStr: "base",
  detectSealDecayServer: "base", markCronStep: "base", hasCronStep: "base", isTradingDayCN: "base",
  fetchMarketDaily: "zt", fetchNuclearCount: "zt", fetchZTPool: "zt",
  fetchLhbDaily: "fund", fetchMarketIntraday: "fund", fetchBoardQuotes: "fund",
  notifyWatchedStockAlerts: "fund", fetchBoardFundServer: "fund", fetchBlockTrades: "fund",
  rankNewsStars: "news", confirmBlackSwansWithLLM: "news", rankFastNewsStars: "news",
  fetchFastNews: "news", fetchAnnouncements: "news", fetchPolicyNews: "news",
  loadRankedAnnTitles: "news", saveRankedAnnTitles: "news", rankStrongAnnouncements: "news",
  runNewsFeedSync: "news",
  runIntradayBrain: "brain", runProactiveStore: "brain", runThemeAnalysis: "brain",
  analyzeDaily: "review", generateDailyReview: "review", runEventClassify: "review",
  runTradeBackfill: "ledger", backfillOnePost: "ledger", runPostSummary: "ledger",
  runUserStyleProfile: "ledger",
  startCron: "KEEP",
};

// base 的显式非函数行区间（函数体由 brace matcher 计算；此处只补：EM_UT / sealPrevMap /
//  共享 require 块 / checkpoint 注释与常量 / 交易日历 IIFE。
//  注意：busy 标志（cronBusy/watchRunning/...）只在 startCron 内赋值 → 必须留在 cron.js 作 let）
const BASE_EXPLICIT = [[13, 13], [219, 219], [533, 542], [1244, 1247], [1278, 1289]];
// 领域附加常量行（不属于函数前导）：[line, domain]
const ADHOC_CONSTS = [
  [13, "base"],   // EM_UT
  [557, "fund"],  // GOOD_ANN_RE
  [625, "news"],  // NEWS_BOOST_RE
  [634, "news"],  // BLACK_ANN_LLM_KEY
  [684, "news"],  // RANKED_NEWS_TITLE_KEY
  [804, "news"],  // POLICY_RE
  [826, "news"],  // STRONG_ANN_RE
  [829, "news"],  // RANKED_ANN_KEY
  [848, "news"],  // BLACK_ANN_RE（startCron 20min 任务也在用 → news 导出，cron.js 再导入）
  [1194, "fund"], // HOST_FUND
];
// 领域额外导出（非函数，供 cron.js 等跨域使用）
const EXTRA_EXPORTS = { news: ["BLACK_ANN_RE"] };

function main() {
  const bodies = findFunctionsWithBodies();
  console.log(`解析到 ${bodies.length} 个顶层函数`);
  const unknown = bodies.filter(f => !(f.name in DOMAIN));
  if (unknown.length) { console.error("未登记函数:", unknown.map(f => f.name).join(", ")); process.exit(1); }

  const ranges = { base: [...BASE_EXPLICIT], zt: [], fund: [], news: [], brain: [], review: [], ledger: [] };
  const covered = (d, a, b) => ranges[d].some(([x, y]) => a >= x && b <= y);
  const push = (d, a, b) => { if (!covered(d, a, b)) ranges[d].push([a, b]); };

  for (const f of bodies) {
    const d = DOMAIN[f.name];
    if (d === "KEEP") continue;
    // 前导注释（仅 // 注释与空行；const 行单独用 ADHOC_CONSTS/显式区间处理）
    let start = f.declLine - 1;
    while (start > 0) {
      const t = lines[start - 1].trim();
      if (t === "" || t.startsWith("//")) { start--; continue; }
      break;
    }
    push(d, start + 1, f.endLine);
  }
  for (const [ln, d] of ADHOC_CONSTS) push(d, ln, ln);

  // 校验：区间互不重叠（全局排序）
  const all = [];
  for (const [d, rgs] of Object.entries(ranges)) for (const [a, b] of rgs) all.push([d, a, b]);
  all.sort((x, y) => x[1] - y[1]);
  for (let i = 1; i < all.length; i++) {
    if (all[i - 1][2] > all[i][1]) {
      console.error(`区间重叠: ${all[i - 1][0]}[${all[i - 1][1]}-${all[i - 1][2]}] vs ${all[i][0]}[${all[i][1]}-${all[i][2]}]`);
      process.exit(1);
    }
    if (all[i - 1][2] === all[i][1] && !DECL_MID_RE.test(lines[all[i][1] - 1])) {
      console.error(`区间同线相接但非 }async function 场景: ${all[i - 1][0]}[${all[i - 1][1]}-${all[i - 1][2]}] vs ${all[i][0]}[${all[i][1]}-${all[i][2]}]`);
      process.exit(1);
    }
  }

  // 生成领域文件
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const DOMAIN_FUNCS = { zt: [], fund: [], news: [], brain: [], review: [], ledger: [], base: [] };
  for (const f of bodies) {
    if (f.name !== "startCron") DOMAIN_FUNCS[DOMAIN[f.name]].push(f.name);
  }
  const BASE_EXPORTS = ["contentKey", "httpsGet", "bjDate", "bjDateStr", "EM_UT", "detectSealDecayServer", "markCronStep", "hasCronStep", "isTradingDayCN", "getJson", "getJsonWithFallback", "requestRaw", "parseLLMJSON", "SCHEMAS", "withPgLock", "LOCK_CRON_MAIN", "LOCK_THEME", "LOCK_WATCH", "LOCK_INTRADAY", "callLLM", "saveFactorIc"];

  for (const d of ["base", "zt", "fund", "news", "brain", "review", "ledger"]) {
    const rgs = ranges[d];
    if (rgs.length === 0) continue;
    const parts = rgs.map(([a, b]) => lines.slice(a - 1, b).join("\n"));
    let body = parts.join("\n\n");
    let header = `// ============================================================\n// server/cron/${d}.js —— 领域模块（v9.139.0 阶段二 #16，split-cron.js 自动拆分）\n// 行为与原 cron.js 逐字一致；原文件已只留调度注册\n// ============================================================\n`;
    if (d === "base") {
      body = body
        .replace("async function markCronStep(dateStr, step) {", "async function markCronStep(pool, dateStr, step) {")
        .replace("async function hasCronStep(dateStr, step) {", "async function hasCronStep(pool, dateStr, step) {");
      header += `// 共享基础设施：EM_UT/contentKey/sealPrevMap+detectSealDecayServer/httpsGet/统一 require/\n// bjDate/bjDateStr/checkpoint(markCronStep/hasCronStep)/busy 标志/交易日历\n`;
      body += `\nmodule.exports = { ${BASE_EXPORTS.join(", ")} };\n`;
    } else {
      const imports = [`const B = require("./base");`];
      imports.push(`const { ${BASE_EXPORTS.join(", ")} } = B;`);
      if (d === "zt") imports.push(`const { fetchLhbDaily, fetchBoardFundServer } = require("./fund");`);
      if (d === "brain") imports.push(`const { fetchZTPool } = require("./zt");`, `const { fetchBoardQuotes } = require("./fund");`);
      if (d === "review") imports.push(`const { rankStrongAnnouncements } = require("./news");`);
      header += imports.join("\n") + "\n";
      const funcs = DOMAIN_FUNCS[d].filter(n => n !== "contentKey" && n !== "httpsGet" && n !== "bjDate" && n !== "bjDateStr" && n !== "detectSealDecayServer" && n !== "isTradingDayCN" && n !== "markCronStep" && n !== "hasCronStep");
      const extras = EXTRA_EXPORTS[d] ?? [];
      body += `\nmodule.exports = { ${[...funcs, ...extras].join(", ")} };\n`;
    }
    const fname = path.join(OUT_DIR, `${d}.js`);
    // 相对路径修正：领域模块位于 server/cron/，require 需上跳一级（src 需上跳两级）
    body = body
      .replace(/require\("\.\/lib\//g, 'require("../lib/')
      .replace(/require\("\.\/routes\//g, 'require("../routes/')
      .replace(/require\("\.\.\/src\//g, 'require("../../src/');
    fs.writeFileSync(fname, header + "\n" + body + "\n");
    const check = execSync(`node --check "${fname}" 2>&1`).toString();
    if (check.trim()) { console.error(`!! ${fname} 语法检查:\n${check}`); process.exit(1); }
    console.log(`✓ ${fname} (${(header + body).split("\n").length} 行)`);
  }

  // ---- 重写 cron.js ----
  const movedAll = [];
  for (const [d, rgs] of Object.entries(ranges)) for (const [a, b] of rgs) movedAll.push([a, b]);
  movedAll.sort((x, y) => x[0] - y[0]);
  const keepRanges = [];
  let cursor = 0;
  for (const [a, b] of movedAll) {
    if (a - 1 > cursor) keepRanges.push([cursor, a - 1]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < N) keepRanges.push([cursor, N]);
  let kept = keepRanges.map(([a, b]) => lines.slice(a, b).join("\n")).join("\n");
  // 校验：保留区必须含 startCron 与 module.exports，且不含已迁走函数声明
  if (!kept.includes("function startCron") || !kept.includes("module.exports")) { console.error("!! 保留内容缺失 startCron/module.exports"); process.exit(1); }
  for (const d of ["zt", "fund", "news", "brain", "review", "ledger"]) {
    for (const f of DOMAIN_FUNCS[d]) {
      if (new RegExp(`^(async )?function ${f}\\s*\\(`, "m").test(kept)) { console.error(`!! ${f} 仍在 cron.js`); process.exit(1); }
    }
  }
  // 去掉原 require 头（https/cron/dotenv 换成 import block）
  kept = kept.replace(/const https = require\("https"\);\n?/, "");
  kept = kept.replace(/const cron = require\("node-cron"\);\n?/, "");
  kept = kept.replace(/require\("dotenv"\)\.config\(\);\n?/, "");
  // 修正 markCronStep/hasCronStep 调用点（显式 pool 参数）
  kept = kept
    .replace(/markCronStep\((dateStr|bjDateStr\(\))\s*,/g, "markCronStep(pool, $1,")
    .replace(/hasCronStep\((dateStr|bjDateStr\(\))\s*,/g, "hasCronStep(pool, $1,");
  const importBlock = [
    `// ============================================================`,
    `// 定时任务调度注册（v9.139.0 阶段二 #16：领域模块拆分后本文件只留调度）`,
    `// 领域模块：cron/base.js（共享基础设施）/ zt.js（涨停池·市场日）/ fund.js（资金·龙虎榜·盯价）`,
    `//           news.js（快讯·公告·政策）/ brain.js（盘中大脑·主题分析）/ review.js（复盘·事件分级）/`,
    `//           ledger.js（成交回填·摘要·画像）`,
    `// ============================================================`,
    `const cron = require("node-cron");`,
    `// v9.26.5：显式加载 .env（独立调用/测试时也能读到 AI 配置）`,
    `require("dotenv").config();`,
    `const B = require("./cron/base");`,
    `const { contentKey, httpsGet, bjDate, bjDateStr, EM_UT, detectSealDecayServer, markCronStep, hasCronStep, isTradingDayCN, getJson, getJsonWithFallback, requestRaw, parseLLMJSON, SCHEMAS, withPgLock, LOCK_CRON_MAIN, LOCK_THEME, LOCK_WATCH, LOCK_INTRADAY, callLLM, saveFactorIc } = B;`,
    `const { fetchMarketDaily, fetchNuclearCount, fetchZTPool } = require("./cron/zt");`,
    `const { fetchLhbDaily, fetchMarketIntraday, fetchBoardQuotes, notifyWatchedStockAlerts, fetchBoardFundServer, fetchBlockTrades } = require("./cron/fund");`,
    `const { rankNewsStars, confirmBlackSwansWithLLM, rankFastNewsStars, fetchFastNews, fetchAnnouncements, fetchPolicyNews, loadRankedAnnTitles, saveRankedAnnTitles, rankStrongAnnouncements, runNewsFeedSync, BLACK_ANN_RE } = require("./cron/news");`,
    `const { runIntradayBrain, runProactiveStore, runThemeAnalysis } = require("./cron/brain");`,
    `const { analyzeDaily, generateDailyReview, runEventClassify } = require("./cron/review");`,
    `const { runTradeBackfill, backfillOnePost, runPostSummary, runUserStyleProfile } = require("./cron/ledger");`,
    ``,
  ].join("\n");
  const out = importBlock + kept.replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n") + "\n";
  fs.writeFileSync(FILE, out);
  const check = execSync(`node --check "${FILE}" 2>&1`).toString();
  if (check.trim()) { console.error(`!! ${FILE} 语法检查:\n${check}`); process.exit(1); }
  console.log(`✓ 重写 ${FILE} (${out.split("\n").length} 行)`);
}

main();

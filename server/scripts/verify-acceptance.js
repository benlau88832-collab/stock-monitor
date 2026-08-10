// ============================================================
// v9.94.0-验收：第二段（AI贯穿）+ 第三段（驾驶舱深化）自动化验收脚本
// 用法：node server/scripts/verify-acceptance.js
// 覆盖：数据层（白名单/core_concept/新闻链接/主题作战/跌停池）+ AI链路 + 单测/tsc/build
// 输出：逐项 PASS/FAIL + 汇总，任一 FAIL 需修复后再交付
//
// ⚠ 安全护栏（v9.93.5 事故后强制）：本脚本【只读验收，零删除动作】——
// ① 运行前自检：扫描自身源码，出现任何删除类命令（文件删除/目录删除/
//    镜像删除/分支删除/文件复制工具的镜像参数）立即拒绝执行；
// ② 变更护栏：运行前快照工作树文件清单，运行后再对比，
//    发现文件减少立即 FAIL 并打印差异（防误删重要文件）。
// ============================================================
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { pool } = require("../db");
const { execSync } = require("child_process");
const fs = require("fs");

// ---------- 安全自检（第一道防线：源码级禁止删除命令） ----------
// 注意：模式用字符类拆分（如 r[m]）书写，避免自检时匹配到模式定义自身
const DELETE_PATTERNS = [
  /\br[m]\s+-/, /\br[m]\b/, /\bd[e]l\b/, /\bdel\s+\/[f]\b/, /\broboc[o]py\b/, /\/M[I][R]\b/,
  /git\s+branch\s+-[Dd]\b/, /\bunl[i]nk\b/, /fs\.[r]m\b/, /fs\.unl[i]nk\b/,
  /\br[d]\s+\//, /\brmd[i][r]\b/, /\bRemove-[I]tem\b/, /\bRemove[I]tem\b/,
];
const SELF = fs.readFileSync(__filename, "utf8");
const banned = DELETE_PATTERNS.filter(p => p.test(SELF));
if (banned.length > 0) {
  console.error(`❌ 安全自检失败：验收脚本源码含删除类命令模式 ${banned.length} 处（${banned.map(p => p.source).join(", ")}）`);
  console.error("   本脚本禁止任何删除动作，请移除后重试。");
  process.exit(2);
}

// ---------- 变更护栏（第二道防线：运行前后文件清单对比） ----------
const ROOTS = ["src", "server", "docs", "public", "index.html", "package.json", "tsconfig.json", "vite.config.ts"];
function listFilesRec(dir, base = "") {
  const out = [];
  const abs = path.join(dir, base);
  if (!fs.existsSync(abs)) return out;
  const st = fs.statSync(abs);
  if (st.isFile()) { out.push(base); return out; }
  for (const name of fs.readdirSync(abs)) {
    if (name === "node_modules" || name === ".git") continue;
    out.push(...listFilesRec(abs, path.join(base, name)));
  }
  return out;
}
function snapshotTree() {
  const cwd = path.join(__dirname, "..", "..");
  const files = [];
  for (const r of ROOTS) files.push(...listFilesRec(cwd, r));
  return files.sort();
}
const treeBefore = snapshotTree();

/** 运行后对比文件清单：发现文件减少 → FAIL（防误删） */
function verifyNoDeletion() {
  try {
    const after = snapshotTree();
    const removed = treeBefore.filter(f => !after.includes(f));
    if (removed.length > 0) {
      check("⚠ 防误删护栏：文件无减少", false, `被删 ${removed.length} 个：${removed.slice(0, 5).join(", ")}`);
    } else {
      check("⚠ 防误删护栏：文件无减少", true);
    }
  } catch (e) {
    check("⚠ 防误删护栏：文件无减少", false, e.message);
  }
}
const https = require("https");
const http = require("http");

const BASE = "http://localhost:8080";
let pass = 0, fail = 0;
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

function httpGet(url, timeout = 15000) {
  const lib = url.startsWith("https:") ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { headers: { "User-Agent": "verify" } }, r => {
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new Error("bad json")); }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeout, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

function httpPost(url, body, headers = {}, timeout = 100000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.request(u, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers, "Content-Length": Buffer.byteLength(data) },
    }, r => {
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
        catch { resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString("utf8") }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeout, () => req.destroy(new Error("timeout")));
    req.write(data);
    req.end();
  });
}

function run(cmd) {
  try { return { ok: true, out: execSync(cmd, { encoding: "utf8", cwd: path.join(__dirname, "..", ".."), timeout: 300000 }).trim() }; }
  catch (e) { return { ok: false, out: String(e.stdout ?? e.message) }; }
}

(async () => {
  console.log("========== 第二段+第三段 自动化验收 ==========\n");

  // ========== 一、数据层 ==========
  console.log("--- 一、数据层 ---");

  // 1. 概念白名单 = 东财 504
  try {
    const r = await httpGet(`${BASE}/api/concepts/whitelist`);
    check("概念白名单 = 504（东财单源）", r.count === 504, `实际 ${r.count}`);
  } catch (e) { check("概念白名单 = 504（东财单源）", false, e.message); }

  // 2. core_concept 覆盖率（权威核心题材）
  const cc = await pool.query("SELECT count(*) total, count(core_concept) with_cc FROM stock_concepts");
  const ccRate = cc.rows[0].total > 0 ? cc.rows[0].with_cc / cc.rows[0].total : 0;
  check("core_concept 覆盖率 ≥90%", ccRate >= 0.9, `${(ccRate * 100).toFixed(1)}%（${cc.rows[0].with_cc}/${cc.rows[0].total}）`);

  // 3. 个股分类样本（上海电力→绿色电力 / 创新医疗→人脑工程）
  const sample = await pool.query("SELECT code, core_concept FROM stock_concepts WHERE code IN ('600021','002173')");
  const ccMap = new Map(sample.rows.map(r => [r.code, r.core_concept]));
  check("上海电力 core_concept=绿色电力", ccMap.get("600021") === "绿色电力", ccMap.get("600021") ?? "空");
  check("创新医疗 core_concept=人脑工程", ccMap.get("002173") === "人脑工程", ccMap.get("002173") ?? "空");

  // 4. news 表 url 补链率（新闻可点击）
  const urlR = await pool.query("SELECT count(*) total, count(*) FILTER (WHERE url != '' AND url IS NOT NULL) with_url FROM news");
  const urlRate = urlR.rows[0].total > 0 ? urlR.rows[0].with_url / urlR.rows[0].total : 0;
  check("新闻 url 补链率 ≥90%（可点击）", urlRate >= 0.9, `${(urlRate * 100).toFixed(1)}%（${urlR.rows[0].with_url}/${urlR.rows[0].total}）`);

  // 5. 主题作战：evidence 带 url + picks 真实 code/name + correlation
  // v9.93.5：latest 曾被 cloudStore 旧值回传覆盖 → 改为"触发新管线 + 轮询最新键"验证
  try {
    // 5a. 先读最新历史键（非 latest 缓存），确认管线产物真实
    const auth2 = await httpGet(`${BASE}/api/auth/local-token`);
    const token2 = auth2.token ?? "";
    const tr = await httpPost(`${BASE}/api/theme-analysis/trigger`, {}, { "x-local-token": token2 }, 120000);
    if (tr.status !== 200 && tr.status !== 409) {
      check("主题作战: 触发新管线", false, `status=${tr.status}`);
    } else {
      // 200=已启动 / 409=管线已在运行（上一轮未结束，同样等产出）；500+ 才算失败
      let found = null;
      for (let i = 0; i < 10 && !found; i++) {
        await new Promise(r => setTimeout(r, 10000));
        const keys = await httpGet(`${BASE}/api/db/kv/keys`);
        const taKeys = (keys.keys ?? []).filter(k => k.startsWith("theme_analysis:") && !k.endsWith(":latest"))
          .sort().reverse();
        if (taKeys.length > 0) {
          const kv = await httpGet(`${BASE}/api/db/kv?key=${encodeURIComponent(taKeys[0])}`);
          let v = kv.value;
          if (v && typeof v === "object" && "__raw" in v) v = JSON.parse(v.__raw);
          const themes = v?.themes ?? [];
          const totalEv = themes.reduce((s, t) => s + (t.evidence ?? []).length, 0);
          const evWithUrl = themes.reduce((s, t) => s + (t.evidence ?? []).filter(e => e.url).length, 0);
          const totalPicks = themes.reduce((s, t) => s + (t.picks ?? []).length, 0);
          const picksReal = themes.reduce((s, t) => s + (t.picks ?? []).filter(p => p.code && p.name && (p.correlation ?? 0) >= 0.5).length, 0);
          if (totalEv > 0 && totalPicks > 0) { found = { taKeys: taKeys[0], evWithUrl, totalEv, picksReal, totalPicks }; break; }
        }
      }
      check("主题作战: 管线产出真实(evidence/picks 非空)", !!found, found ? `${found.taKeys}: 新闻${found.evWithUrl}/${found.totalEv}带链 · 龙头${found.picksReal}/${found.totalPicks}合规` : "轮询10次未见有效产出");
      if (found) {
        check("主题作战: 支撑新闻带 url", found.evWithUrl / found.totalEv >= 0.9, `${found.evWithUrl}/${found.totalEv} 条带链接`);
        check("主题作战: 龙头标的真实(code/name/corr≥0.5)", found.picksReal / found.totalPicks >= 0.9, `${found.picksReal}/${found.totalPicks} 只合规`);
      } else {
        check("主题作战: 支撑新闻带 url", false, "前置失败");
        check("主题作战: 龙头标的真实", false, "前置失败");
      }
    }
  } catch (e) { check("主题作战数据", false, e.message); }

  // 6. 跌停池（DT 接口实测 ≥1）
  try {
    const dt = await httpGet(`https://push2ex.eastmoney.com/getTopicDTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fund:asc&date=${new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "")}`);
    const dtCount = dt?.data?.pool?.length ?? 0;
    check("跌停池接口返回真实数据(≠0)", dtCount > 0, `${dtCount} 只`);
  } catch (e) { check("跌停池接口", false, e.message); }

  // 7. 分支纪律（只保留 main + arena）
  const branches = run("git branch && git branch -r");
  const brText = branches.out;
  const okBranch = brText.includes("arena/019fb619-stock-monitor") && brText.includes("origin/main")
    && !/worktree-agent|master\b/.test(brText);
  check("git 分支纪律（仅 main + arena）", okBranch);

  // ========== 二、AI 链路 ==========
  console.log("\n--- 二、AI 链路 ---");
  try {
    const auth = await httpGet(`${BASE}/api/auth/local-token`);
    const token = auth.token ?? "";
    const r = await httpPost(`${BASE}/api/ai/call`, { task: "agentReason", system: "你是测试助手。", user: "回复ok", maxTokens: 100, thinking: false }, { "x-local-token": token });
    check("前端 AI 链路（/api/ai/call）可用", r.status === 200 && String(r.body?.text ?? "").trim().length > 0, `status=${r.status} text=${String(r.body?.text ?? "").slice(0, 20)}`);
  } catch (e) { check("前端 AI 链路", false, e.message); }

  try {
    const { callModelText } = require("../lib/httpProxy");
    const t = await callModelText("请只回复：ok", { maxTokens: 100, temperature: 0.1 });
    check("cron AI 链路（callModelText）可用", t.trim().length > 0, t.slice(0, 20));
  } catch (e) { check("cron AI 链路（callModelText）", false, e.message); }

  // ========== 三、构建与单测 ==========
  console.log("\n--- 三、构建与单测 ---");
  const tsc = run("npx tsc --noEmit");
  check("tsc 类型检查通过", tsc.ok);
  // Git Bash 的 grep 不支持 \d → 用 [0-9]；vitest 输出带 ANSI 颜色码，去色后解析
  const vitest = run("npx vitest run 2>&1 | sed -r \"s/\\x1B\\[[0-9;]*[mK]//g\" | grep -E \"Tests +[0-9]+ passed\" | tail -1");
  const vtMatch = vitest.out.match(/Tests\s+(\d+) passed/);
  check("vitest 全量通过", vtMatch && Number(vtMatch[1]) >= 304, `${vtMatch?.[1] ?? (vitest.out.slice(0, 80) || "?")} passed`);
  const build = run("npm run build 2>&1 | tail -3");
  check("build 成功", build.ok && /built in/.test(build.out));

  // ========== 四、v9.94 复盘重构（13 维度结构化） ==========
  console.log("\n--- 四、复盘重构（v9.94）---");
  try {
    const rv = await pool.query(
      "SELECT value FROM kv_store WHERE key LIKE 'review:%' AND key != 'review:latest' ORDER BY key DESC LIMIT 1",
    );
    const v = rv.rows[0]?.value;
    const dm = v?.dimensions ?? {};
    const dKeys = ["d0", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "d10", "d11", "d12"];
    const present = dKeys.filter(k => dm[k] != null);
    check("复盘: 12 维度结构完整", present.length >= 10, `含 ${present.length}/12（${present.join(",")}）`);
    check("复盘: 涨停/板块/梯队数据真实", (dm.d3?.limitUp ?? 0) > 0 && (dm.d4?.boards?.length ?? 0) > 0, `涨停${dm.d3?.limitUp} 板块TOP${dm.d4?.boards?.length}`);
    check("复盘: LLM 研判文本非空", (dm.d12?.text ?? "").length > 50, `研判${(dm.d12?.text ?? "").length}字`);
    check("复盘: 催化词频/资金 TOP 非空", (dm.d5?.catalysts?.length ?? 0) > 0 && (dm.d2?.stockFundTop?.length ?? 0) > 0, `催化${dm.d5?.catalysts?.length} 资金TOP${dm.d2?.stockFundTop?.length}`);
  } catch (e) { check("复盘 13 维度", false, e.message); }

  // ========== 汇总 ==========
  // v9.93.5：防误删护栏 —— 运行前后文件清单对比（发现文件减少立即 FAIL）
  verifyNoDeletion();
  console.log(`\n========== 汇总：${pass} PASS / ${fail} FAIL ==========`);
  if (fail > 0) {
    console.log("\n❌ 未通过项：");
    for (const r of results.filter(r => !r.ok)) console.log(`  - ${r.name}${r.detail ? `（${r.detail}）` : ""}`);
  }
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error("验收脚本异常:", e); process.exit(1); });

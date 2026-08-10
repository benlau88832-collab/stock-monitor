// ============================================================
// v9.94.0-验收：第二段（AI贯穿）+ 第三段（驾驶舱深化）自动化验收脚本
// 用法：node server/scripts/verify-acceptance.js
// 覆盖：数据层（白名单/core_concept/新闻链接/主题作战/跌停池）+ AI链路 + 单测/tsc/build
// 输出：逐项 PASS/FAIL + 汇总，任一 FAIL 需修复后再交付
// ============================================================
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { pool } = require("../db");
const { execSync } = require("child_process");
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

  // ========== 汇总 ==========
  console.log(`\n========== 汇总：${pass} PASS / ${fail} FAIL ==========`);
  if (fail > 0) {
    console.log("\n❌ 未通过项：");
    for (const r of results.filter(r => !r.ok)) console.log(`  - ${r.name}${r.detail ? `（${r.detail}）` : ""}`);
  }
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error("验收脚本异常:", e); process.exit(1); });

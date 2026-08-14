// v9.144.0 全站波段闭环 E2E：分析→录逻辑→加盯盘→纸上成交→破位提醒→清理
// 运行：node --env-file=server/.env scripts/e2e-swing-loop.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const BASE = "http://localhost:8080";
const MARK = `E2E_AUDIT_${Date.now()}`;
const CODE = "600522";

const json = async (r) => {
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
};
const req = async (method, path, body, token) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { "x-local-token": token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(70000),
  });
  const j = await json(r);
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(j)}`);
  return j;
};

const { pool } = require("../server/db.js");

const cleanup = async (token) => {
  try {
    const logicRows = await pool.query(`SELECT id FROM logic_ledger WHERE thesis LIKE $1`, [`${MARK}%`]);
    for (const row of logicRows.rows) {
      await req("DELETE", `/api/portfolio/logic/${row.id}`, null, token);
    }
    await req("POST", "/api/watch/remove", { code: CODE }, token);
    await pool.query(`DELETE FROM trade_ledger WHERE notes LIKE $1`, [`${MARK}%`]);
    await pool.query(`DELETE FROM decision_post WHERE notes LIKE $1`, [`${MARK}%`]);
  } catch (e) {
    console.error("[cleanup] failed:", e.message);
  }
};

const main = async () => {
  const auth = await req("GET", "/api/auth/local-token");
  const token = auth.token;
  let logicId = null;
  try {
    // 1. 分析
    const decision = await req("POST", "/api/decisions/swing", { code: CODE }, token);
    if (!decision?.decision) throw new Error("decision missing");
    const price = Number(decision.snap?.price || 35.55);
    console.log("[1] decision", decision.decision.verdict, decision.fromLLM ? "LLM" : "规则", decision.llmError || "");

    // 2. 录逻辑
    const logic = await req("POST", "/api/portfolio/logic", {
      code: CODE,
      name: "中天科技",
      thesis: `${MARK} 波段逻辑：产业链中游+趋势主升`,
      breakLine: Math.round(price * 0.95 * 100) / 100,
      board: "通信",
      invalidationConditions: ["跌破买点或MA20，波段逻辑失效"],
      reviewCycleDays: 7,
      simulated: true,
    }, token);
    logicId = logic.logic?.id;
    console.log("[2] logic", logicId);

    // 3. 加盯盘
    await req("POST", "/api/watch/add", {
      code: CODE,
      name: "中天科技",
      buy_low: Math.round(price * 0.98 * 100) / 100,
      buy_high: Math.round(price * 1.02 * 100) / 100,
      stop_loss: Math.round(price * 0.95 * 100) / 100,
      trigger_pct: 5,
      note: MARK,
    }, token);
    console.log("[3] watch added");

    // 4. 纸上成交
    await req("POST", "/api/portfolio/trade", {
      code: CODE,
      name: "中天科技",
      action: "buy",
      price,
      quantity: 100,
      cost: price,
      simulated: true,
      notes: `${MARK} 纸上确认`,
    }, token);
    console.log("[4] paper trade");

    // 5. 断言组合闭环
    const port = await req("GET", "/api/portfolio");
    const hasLogic = port.logic?.some((x) => String(x.thesis || "").startsWith(MARK));
    const hasSim = port.simulatedPositions?.some((x) => x.code === CODE);
    if (!hasLogic || !hasSim) throw new Error("logic/simulated position missing");
    console.log("[5] portfolio ok logic/sim", hasLogic, hasSim);

    // 6. 触发破位：把破位线抬到现价上方
    const breakLine = Math.round(price * 1.2 * 100) / 100;
    await req("POST", "/api/portfolio/logic", {
      id: logicId,
      code: CODE,
      name: "中天科技",
      thesis: `${MARK} 波段逻辑：产业链中游+趋势主升`,
      status: "验证中",
      breakLine,
      board: "通信",
      invalidationConditions: ["跌破买点或MA20，波段逻辑失效"],
      reviewCycleDays: 7,
      simulated: true,
    }, token);
    const port2 = await req("GET", "/api/portfolio");
    const breakTodo = port2.todos?.some((t) => t.type === "break_line" && t.code === CODE);
    if (!breakTodo) throw new Error("break_line todo missing");
    console.log("[6] break_line todo ok");

    console.log("E2E_SWING_LOOP_OK");
  } finally {
    await cleanup(token);
    await pool.end();
  }
};

main().catch((e) => {
  console.error("E2E_FAIL", e.message);
  process.exit(1);
});

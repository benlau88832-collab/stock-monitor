// ============================================================
// v9.66：个股深度调研后端 —— 妙想 API 中转（mx-data / mx-search 能力）
// 调用本机 Python 脚本（.workbuddy/skills/mx-{data,search}/），MX_APIKEY 从环境变量读
// 三个接口：
//   GET /api/research/quote?code=600522     行情/估值速览（mx-data）
//   GET /api/research/data?q=财务三表       结构化数据查询（mx-data）
//   GET /api/research/search?q=研报         资讯搜索（mx-search）
// 返回 { ok, text } —— stdout 的 markdown 文本（AI/前端可直接展示）
// ============================================================
const { execFile } = require("child_process");
const path = require("path");

const PYTHON = "C:/Python312/python.exe";
const MX_DATA = "C:/Users/Administrator/.workbuddy/skills/mx-data/mx_data.py";
const MX_SEARCH = "C:/Users/Administrator/.workbuddy/skills/mx-search/mx_search.py";
const OUT_DIR = path.join(__dirname, "..", "tmp", "mx");

function runMx(script, query, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (!env.MX_APIKEY) { resolve({ ok: false, error: "MX_APIKEY 未配置（server/.env 或系统环境变量）" }); return; }
    execFile(
      PYTHON, [script, query, OUT_DIR],
      { env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) { resolve({ ok: false, error: `mx 调用失败: ${err.message}` }); return; }
        const text = String(stdout || "").trim();
        if (!text) { resolve({ ok: false, error: "mx 返回空（请检查 API Key/网络）" }); return; }
        resolve({ ok: true, text: text.slice(0, 6000) });
      },
    );
  });
}

module.exports = function researchRoutes(app) {
  app.get("/api/research/quote", async (req, res) => {
    const code = String(req.query.code || "").trim();
    if (!code) return res.status(400).json({ error: "code required" });
    const r = await runMx(MX_DATA, `${code} 最新价 总市值 市盈率 近1月涨跌幅`);
    res.json(r);
  });

  app.get("/api/research/data", async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "q required" });
    const r = await runMx(MX_DATA, q);
    res.json(r);
  });

  app.get("/api/research/search", async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "q required" });
    const r = await runMx(MX_SEARCH, q);
    res.json(r);
  });

  // v10-7（P2）：调研报告落库（AIConsole 调研完成后自动调用，同日幂等覆盖）
  app.post("/api/research/report", async (req, res) => {
    try {
      const { pool } = require("../db");
      const b = req.body ?? {};
      const code = String(b.code || "").trim();
      if (!code) return res.status(400).json({ error: "code required" });
      await pool.query(
        `INSERT INTO research_reports(code,name,report_date,phase,summary_json,valuation_json,levels_json,rr_json,full_text,created_at)
         VALUES($1,$2,CURRENT_DATE,$3,$4,$5,$6,$7,$8,now())
         ON CONFLICT(code,report_date) DO UPDATE SET
           name=EXCLUDED.name, phase=EXCLUDED.phase, summary_json=EXCLUDED.summary_json,
           valuation_json=EXCLUDED.valuation_json, levels_json=EXCLUDED.levels_json,
           rr_json=EXCLUDED.rr_json, full_text=EXCLUDED.full_text, created_at=now()`,
        [code, String(b.name || "").slice(0, 40), Number(b.phase ?? 4),
          b.summary_json ? JSON.stringify(b.summary_json) : null,
          b.valuation_json ? JSON.stringify(b.valuation_json) : null,
          b.levels_json ? JSON.stringify(b.levels_json) : null,
          b.rr_json ? JSON.stringify(b.rr_json) : null,
          String(b.full_text || "").slice(0, 20000)],
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // v10-7（P2）：按代码批量查最新调研报告（选股清单显示"🔬 深度调研"用）
  app.get("/api/research/reports", async (req, res) => {
    try {
      const { pool } = require("../db");
      const codes = String(req.query.codes || "").split(",").map(s => s.trim()).filter(Boolean);
      if (codes.length === 0) return res.json({ ok: true, items: [] });
      const r = await pool.query(
        `SELECT DISTINCT ON (code) code, name, report_date, phase, summary_json, valuation_json, levels_json, rr_json
         FROM research_reports WHERE code = ANY($1) ORDER BY code, report_date DESC`, [codes],
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};

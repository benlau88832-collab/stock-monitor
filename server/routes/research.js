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
};

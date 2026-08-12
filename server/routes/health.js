// ============================================================
// server/routes/health.js —— 统一健康聚合端点（v9.114.0，T5-2 D-10 收尾）
// 聚合：/api/proxy/health（数据源）+ /api/ai/health（AI 端点）+ PG 连通 + SW 缓存版本
// 前端 OpsPanel 单次请求即得全链路 SLA；终审 D-10：各源/各端点健康分散 → 统一视图
// ============================================================
const fs = require("fs");
const path = require("path");
const { getSourceHealth } = require("./proxy");      // v9.114.0：proxy.js 已导出数据源健康快照
const { getHealth } = require("../lib/aiHealth");     // AI 端点熔断/empty 率
const { pool } = require("../db");                    // PG 连接池（SELECT 1 探活）

module.exports = function healthRoutes(app) {
  app.get("/api/health", async (req, res) => {
    const out = { at: new Date().toISOString() };
    // ① 数据源健康（push2/push2delay 等 host 状态/冷却/成功率 60s 窗口）
    try { out.sources = getSourceHealth(); } catch (e) { out.sources = { error: e.message }; }
    // ② AI 端点健康（熔断状态/empty 率）
    try { out.ai = getHealth(); } catch (e) { out.ai = { error: e.message }; }
    // ③ PG 连通探活（SELECT 1 + 延迟）
    try {
      const t0 = Date.now();
      await pool.query("SELECT 1");
      out.pg = { ok: true, latencyMs: Date.now() - t0 };
    } catch (e) {
      out.pg = { ok: false, error: e.message };
    }
    // ④ SW 缓存版本（读 public/sw.js 的 CACHE 常量；部署目录不存在/解析失败 → null）
    try {
      const swPath = path.join(__dirname, "../../public/sw.js");
      const src = fs.readFileSync(swPath, "utf8");
      const m = src.match(/const CACHE = "([^"]+)"/);
      out.sw = { cache: m ? m[1] : null };
    } catch { out.sw = { cache: null }; }
    // ⑤ 应用版本（读源码 index.html <title> 的 vX.Y.Z，与前端 version.ts 同源同步；解析失败 → null）
    try {
      const htmlPath = path.join(__dirname, "../../index.html");
      const html = fs.readFileSync(htmlPath, "utf8");
      const m = html.match(/<title>[^<]*?v(\d+\.\d+\.\d+)/);
      out.version = m ? `v${m[1]}` : null;
    } catch { out.version = null; }
    // ⑥ v9.115.0（S1-2）：认知层 check（version/hash/asOf —— 全站唯一认知状态）
    try {
      const { getCognition } = require("./cognition");
      const cog = await getCognition();
      out.cognition = {
        ok: !!cog && !!cog.hash,
        version: cog?.version ?? null,
        hash: cog?.hash ?? null,
        asOf: cog?.asOf ?? null,
        stage: cog?.sentiment?.value?.stage ?? null,
      };
    } catch (e) {
      out.cognition = { ok: false, error: e.message };
    }
    res.json(out);
  });
};

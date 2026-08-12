// ============================================================
// server/routes/news.js —— 个股资讯聚合 API（v9.124.0，蓝图 4A T-资讯-1）
// GET /api/news?code=600519[&name=贵州茅台][&limit=30] →
//   news_feed 该股资讯（跨源打标）∪ 快讯标题/摘要名称匹配兜底（news 表 code=文章 ID，v9.97.0-fix 同口径）。
// 蓝图 4A.6 资讯区①公告走既有 /api/db/stock/:code；本端点只补 ②新闻/快讯维度。
// 0 token（纯读库）；抓取失败静默（news_feed 为空时仅快讯兜底，永不 500 空白）。
// ============================================================
const { pool } = require("../db");

module.exports = function newsRoutes(app) {
  app.get("/api/news", async (req, res) => {
    try {
      const code = String(req.query.code ?? "").trim();
      const limit = Math.min(Number(req.query.limit) || 30, 100);
      if (!code) return res.status(400).json({ error: "missing code" });
      // 1) news_feed 聚合（跨源打标资讯）
      const feedR = await pool.query(
        `SELECT type,source,title,summary,url,impact,entities,time FROM news_feed
         WHERE code=$1 ORDER BY time DESC LIMIT $2`, [code, limit]).catch(() => ({ rows: [] }));
      // 2) 快讯兜底：名称匹配（优先入参 name，其次 price_watch 盯价表名称）
      const nameParam = String(req.query.name ?? "").trim();
      let stockName = nameParam;
      if (!stockName) {
        const watchR = await pool.query(`SELECT name FROM price_watch WHERE code=$1 LIMIT 1`, [code]).catch(() => ({ rows: [] }));
        stockName = watchR.rows[0]?.name ?? "";
      }
      let newsRows = [];
      if (stockName) {
        const like = `%${stockName}%`;
        const r = await pool.query(
          `SELECT code AS art_code,title,summary,boards,sentiment,stars,time,url FROM news
           WHERE title ILIKE $1 OR summary ILIKE $1 ORDER BY time DESC LIMIT $2`, [like, limit]).catch(() => ({ rows: [] }));
        newsRows = r.rows.map((n) => ({
          type: "kuaixun", source: "eastmoney", code,
          title: n.title, summary: n.summary ?? "",
          url: n.url ?? (n.art_code ? `https://finance.eastmoney.com/a/${n.art_code}.html` : ""),
          impact: n.sentiment ?? null,
          entities: Array.isArray(n.boards) ? n.boards : [],
          time: n.time,
        }));
      }
      const items = [...feedR.rows, ...newsRows]
        .sort((a, b) => String(b.time ?? "").localeCompare(String(a.time ?? "")))
        .slice(0, limit);
      res.json({
        code,
        items,
        sampleSize: items.length,
        caliber: "资讯聚合=news_feed 跨源打标（emweb 个股新闻/后续财联社·研报）∪ 快讯名称匹配兜底；impact=LLM 分级 sentiment 或 null；日期带横杠；来源标注 source",
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};

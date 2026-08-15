// ============================================================
// server/lib/commodityPrice.js —— 免费大宗商品价格采集（v9.140.0 阶段三 #13）
// 背景：Q6 用户接受免费外部页（生意社/百川）作景气度价格数据源。
// 实测结论（2026-08-14）：
//   - 生意社 100ppi.com：首页 JS challenge（robots noindex + 脚本校验），/api/ 需商业密钥 →
//     标记 BLOCKED，留接口位（fetchShengyishe 抛出带标记错误），不浪费出站
//   - 百川盈孚 baiinfo.com：首页 SSR 直出"今日涨跌"轮播（81 项商品：名称/单位/现价/涨跌方向），
//     无需登录可直接解析 → 主源
// 数据流：百川首页 HTML → parseBaiinfoPrices（纯函数）→ kv commodity_price:YYYY-MM-DD
// 消费方：cron 定时（09:20/15:10 交易日）→ 前端 /api/db/kv 读取（零新增路由）
// ============================================================
const { requestRaw } = require("./outbound");

const BAIINFO_HOME = "https://www.baiinfo.com/";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * 解析百川首页"今日涨跌"轮播（纯函数，可单测）。
 * 结构（实测）：<div class="carousel-item ..."> 内含若干商品块：
 *   <div class="mb-[8px] text-[14px]">名称 <span class="unit-style">(单位)</span></div>
 *   <div class="up/down flex ..."><span ...>价格</span><img .../>（方向箭头）<span>涨跌幅%</span></div>
 * @param {string} html
 * @returns {Array<{name:string; unit:string; price:number|null; dir:"up"|"down"|"flat"; pct:number|null}>}
 */
function parseBaiinfoPrices(html) {
  if (!html || typeof html !== "string" || html.length < 1000) return [];
  const items = [];
  // 按商品块切分：每个块 = ">名称 <span class=\"unit-style\"" 起始（split 消费引号，段尾无引号）
  const blocks = html.split(/unit-style"/g);
  for (let i = 0; i < blocks.length - 1; i++) {
    const seg = blocks[i];
    // 名称：段尾的 ">xxx <span class="（split 已消费 "unit-style" 部分，段尾止于 class="）
    const nameM = seg.match(/>([^<>]{1,20})\s*<span class="$/);
    if (!nameM) continue;
    const name = nameM[1].trim();
    if (!name || name.length > 14) continue; // 商品名通常 ≤8 字
    // 单位：unit-style 后的 (xxx)
    const unitM = blocks[i + 1].match(/\(([^)]{1,12})\)/);
    const unit = unitM ? unitM[1].trim() : "";
    // 方向与价格：两种卡片结构（实测）
    //  A) 轮播卡：<div class="up|down flex ..." data-v-xxx><span ...>价格</span> —— 无 up/down 类 = 持平
    //  B) 涨幅榜卡：<p class="h-[40px] leading-40 text-right w-[90px]" data-v-xxx>价格</p>
    const dirM = blocks[i + 1].match(/class="(up|down)?\s*flex[^"]*"[^>]*>\s*<span[^>]*>\s*([\d.,]+)\s*<\/span>/)
      || blocks[i + 1].match(/<p class="h-\[40px\] leading-40 text-right w-\[90px\]"[^>]*>\s*([\d.,]+)\s*<\/p>/);
    if (!dirM) continue;
    const dir = dirM[1] ? (dirM[1] === "up" ? "up" : "down") : "flat";
    const price = Number((dirM[2] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(price) || price <= 0) continue;
    // 涨跌幅（方向 img 之后通常有 pct；无则 null）
    const afterImg = blocks[i + 1].slice(blocks[i + 1].indexOf("</span>") + 7);
    const pctM = afterImg.match(/([+-]?[\d.]+)%/);
    const pct = pctM ? Number(pctM[1]) : null;
    // 去重（轮播多页同商品重复出现，保留首个）
    if (items.some(x => x.name === name)) continue;
    items.push({ name, unit, price, dir, pct: pct != null && Number.isFinite(pct) ? pct : null });
    if (items.length >= 200) break;
  }
  return items;
}

/** 抓取百川首页并解析（主源）；返回 {source, asOf, items}；网络失败抛错（调用方降级） */
async function fetchBaiinfoPrices() {
  const r = await requestRaw(BAIINFO_HOME, { timeout: 10000, headers: { "User-Agent": BROWSER_UA } });
  if (r.status && (r.status < 200 || r.status >= 300)) throw new Error(`http ${r.status}`);
  const items = parseBaiinfoPrices(r.body);
  if (items.length === 0) throw new Error("baiinfo parse empty");
  return { source: "baiinfo", asOf: new Date().toISOString(), items };
}

/** 生意社占位（实测 blocked）：首页 JS challenge + 开放 API 需密钥 —— 留接口位，调用即抛 */
async function fetchShengyishePrices() {
  const err = new Error("100ppi.com blocked（JS challenge / API 需商业密钥），请改用 baiinfo");
  err.blocked = true;
  throw err;
}

/** 统一入口：主源百川 → 失败降级生意社（预期仍失败，带 blocked 标记）→ 抛错由调用方决定 */
async function fetchCommodityPrices() {
  try {
    return await fetchBaiinfoPrices();
  } catch (e) {
    try { return await fetchShengyishePrices(); } catch (e2) { throw e2.blocked ? e2 : e; }
  }
}

/** 落库：kv commodity_price:日期（对象 {date, source, asOf, items}，幂等覆盖） */
async function saveCommodityPrices(pool, payload) {
  const dateStr = payload.date ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
     ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
    [`commodity_price:${dateStr}`, JSON.stringify({ ...payload, date: dateStr })],
  );
  return dateStr;
}

/** 历史价格序列（任务 05，v9.148.0）：查近 N 天 commodity_price:日期 键，按日倒序返回。
 * 返回：{ dates: string[], byDate: [{date, items: [{name,price,unit,dir,pct}]}], byName: {品种名: [{date,price,dir,pct}]} }
 * byName 供"涨价到哪一环"趋势判断与前端走势图（30 天）使用；无数据返回空结构。
 */
async function getCommodityPriceHistory(pool, { days = 30 } = {}) {
  const r = await pool.query(
    `SELECT key, value FROM kv_store WHERE key LIKE 'commodity_price:%'
     ORDER BY key DESC LIMIT $1`,
    [Math.max(7, Math.min(120, days))],
  );
  const byDate = [];
  for (const row of r.rows) {
    let v = row.value;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { continue; } }
    if (!Array.isArray(v?.items)) continue;
    byDate.push({
      date: String(row.key.replace("commodity_price:", "")),
      items: v.items.map((x) => ({
        name: String(x.name ?? ""),
        price: x.price != null ? Number(x.price) : null,
        unit: x.unit ?? "",
        dir: x.dir ?? "flat",
        pct: x.pct != null ? Number(x.pct) : null,
      })),
    });
  }
  // 转 byName 序列（品种 → 按日期）
  const byName = {};
  for (const d of byDate) {
    for (const it of d.items) {
      if (!it.name) continue;
      if (!byName[it.name]) byName[it.name] = [];
      byName[it.name].push({ date: d.date, price: it.price, dir: it.dir, pct: it.pct });
    }
  }
  return { dates: byDate.map((d) => d.date), byDate, byName };
}

module.exports = { parseBaiinfoPrices, fetchBaiinfoPrices, fetchShengyishePrices, fetchCommodityPrices, saveCommodityPrices, getCommodityPriceHistory };

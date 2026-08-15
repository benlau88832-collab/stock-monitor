// ============================================================
// server/lib/klineDb.js —— 本地日K缓存层（v9.147.0 数据基建·阶段一）
// 背景：波段决策卡 K 线实时抓 push2his（断源即报"K线数据不足<30根"）；
//   本地新增 kline_daily 表 = 通达信 .day 全市场导入 + 腾讯 qfq 兜底回填。
// 读路径约定：本地优先（getLocalKlines*），实时源仅作兜底并回写缓存。
// 复权口径声明：通达信 .day = 不复权原始价；腾讯 qfq 回填 = 前复权。
//   swingStage 仅用 MA 排列/平台/突破等形态，短窗口内两口径形态一致；
//   同一 code 冲突时保留先写入者（DO NOTHING），腾讯兜底只补本地缺失标的。
// ============================================================
const fs = require("fs");
const path = require("path");
const { getJson } = require("./outbound");

const TDX_BAR_BYTES = 32;

/** 通达信 .day 单文件解析（32字节/条：date int32(YYYYMMDD) + 开高低收 int32(×100) + amount float + volume int32 + 保留） */
function parseTdxDayFile(filePath) {
  const b = fs.readFileSync(filePath);
  const n = Math.floor(b.length / TDX_BAR_BYTES);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const o = i * TDX_BAR_BYTES;
    const ymd = b.readInt32LE(o);
    if (ymd < 19900101 || ymd > 21001231) continue;
    const date = `${Math.floor(ymd / 10000)}-${String(Math.floor(ymd / 100) % 100).padStart(2, "0")}-${String(ymd % 100).padStart(2, "0")}`;
    const close = b.readInt32LE(o + 16) / 100;
    if (!Number.isFinite(close) || close <= 0) continue;
    rows.push({
      date,
      open: b.readInt32LE(o + 4) / 100,
      high: b.readInt32LE(o + 8) / 100,
      low: b.readInt32LE(o + 12) / 100,
      close,
      volume: b.readInt32LE(o + 24),
      amount: b.readFloatLE(o + 20),
    });
  }
  return rows;
}

/** 文件名 → { market, code }：sh600487.day → { market:'sh', code:'600487' } */
function tdxFileToMeta(fileName) {
  const m = /^(sh|sz|bj)(\d{6})\.day$/i.exec(fileName);
  if (!m) return null;
  return { market: m[1].toLowerCase(), code: m[2] };
}

/** 批量 upsert（unnest 数组参数，DO NOTHING 幂等；force=true 时 DO UPDATE） */
async function upsertKlines(pool, rows, source, force = false) {
  if (!Array.isArray(rows) || rows.length === 0) return { inserted: 0 };
  const codes = [], dates = [], opens = [], highs = [], lows = [], closes = [], volumes = [], amounts = [];
  for (const r of rows) {
    codes.push(r.code); dates.push(r.date);
    opens.push(r.open); highs.push(r.high); lows.push(r.low); closes.push(r.close);
    volumes.push(r.volume ?? 0); amounts.push(r.amount ?? 0);
  }
  const conflict = force
    ? `ON CONFLICT (code, date) DO UPDATE SET
        open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, close=EXCLUDED.close,
        volume=EXCLUDED.volume, amount=EXCLUDED.amount, source=EXCLUDED.source, created_at=now()`
    : `ON CONFLICT (code, date) DO NOTHING`;
  await pool.query(
    `INSERT INTO kline_daily(code,date,open,high,low,close,volume,amount,source)
     SELECT t.code, t.date, t.open, t.high, t.low, t.close, t.volume, t.amount, $9::text
     FROM unnest($1::text[], $2::text[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::float8[])
       AS t(code, date, open, high, low, close, volume, amount)
     ${conflict}`,
    [codes, dates, opens, highs, lows, closes, volumes, amounts, String(source || "tdx")],
  );
  return { inserted: rows.length };
}

/** 本地读：最近 days 根（升序），返回对象数组 [{date,open,high,low,close,volume,amount}] */
async function getLocalKlines(pool, code, days = 160) {
  const r = await pool.query(
    `SELECT date,open,high,low,close,volume,amount FROM kline_daily
     WHERE code=$1 ORDER BY date DESC LIMIT $2`,
    [String(code), Math.max(1, Math.min(3000, Number(days) || 160))],
  );
  return r.rows.reverse(); // 升序
}

/** 本地读：东财 klines 字符串形态（"date,open,close,high,low,volume,amount"），与 /api/proxy/stock-kline 契约一致 */
async function getLocalKlinesStrings(pool, code, days = 160) {
  const rows = await getLocalKlines(pool, code, days);
  return rows.map((r) => `${r.date},${r.open},${r.close},${r.high},${r.low},${r.volume},${r.amount ?? 0}`);
}

/** 本地 max(date)（批量，用于增量跳过） */
async function getLocalMaxDates(pool, codes) {
  if (!Array.isArray(codes) || codes.length === 0) return {};
  const r = await pool.query(
    `SELECT code, max(date) AS max_date FROM kline_daily WHERE code = ANY($1::text[]) GROUP BY code`,
    [codes],
  );
  return Object.fromEntries(r.rows.map((x) => [x.code, x.max_date]));
}

/** 扫描通达信 vipdoc/lday 目录入库。
 *  opts: { markets:['sh','sz','bj'], incremental:boolean, sinceMs:number(仅增量，mtime 过滤),
 *          force:boolean, batchSize:number, logEvery:number }
 *  返回 { files, bars, skippedFiles, errors } */
async function importTdxDir(pool, vipdocBase, opts = {}) {
  const markets = opts.markets ?? ["sh", "sz", "bj"];
  const incremental = !!opts.incremental;
  const sinceMs = opts.sinceMs ?? 0;
  const force = !!opts.force;
  const batchSize = opts.batchSize ?? 50000;
  const logEvery = opts.logEvery ?? 200;
  const stats = { files: 0, bars: 0, skippedFiles: 0, errors: [] };

  const files = [];
  for (const m of markets) {
    const dir = path.join(vipdocBase, m, "lday");
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/\.day$/i.test(f)) continue;
      const meta = tdxFileToMeta(f);
      if (!meta || meta.market !== m) continue;
      const p = path.join(dir, f);
      let st = null;
      try { st = fs.statSync(p); } catch { continue; }
      if (incremental && st.mtimeMs < sinceMs) continue;
      files.push({ p, ...meta, mtime: st.mtimeMs });
    }
  }
  if (files.length === 0) return stats;
  stats.files = files.length;

  // 增量模式：批量查本地 max(date) 跳过已覆盖文件
  let maxDates = {};
  if (incremental) {
    const codes = [...new Set(files.map((f) => f.code))];
    maxDates = await getLocalMaxDates(pool, codes);
  }

  let batch = [];
  const flush = async () => {
    if (batch.length === 0) return;
    await upsertKlines(pool, batch, "tdx", force);
    stats.bars += batch.length;
    batch = [];
  };

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      const rows = parseTdxDayFile(f.p);
      const maxDate = maxDates[f.code];
      const usable = incremental && maxDate ? rows.filter((r) => r.date > maxDate) : rows;
      if (usable.length === 0) { stats.skippedFiles++; continue; }
      for (const r of usable) batch.push({ code: f.code, ...r });
      if (batch.length >= batchSize) await flush();
      if ((i + 1) % logEvery === 0) {
        console.log(`[klineDb] tdx 导入进度 ${i + 1}/${files.length}（bars=${stats.bars}）`);
      }
    } catch (e) {
      stats.errors.push({ file: f.p, err: String(e?.message || e) });
    }
  }
  await flush();
  console.log(`[klineDb] tdx 导入完成 files=${stats.files} bars=${stats.bars} skipped=${stats.skippedFiles} errors=${stats.errors.length}`);
  return stats;
}

/** 腾讯 fqkline 拉取（qfq 前复权）→ 对象数组（升序） */
async function fetchTencentKlines(code, days = 160) {
  const q = /^(60|68|5)/.test(code) ? `sh${code}` : `sz${code}`;
  const txUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${q},day,,,${days},qfq`;
  const tj = await getJson(txUrl, { timeout: 8000, source: "tencent" });
  const rows = tj.data?.data?.[q]?.qfqday ?? tj.data?.data?.[q]?.day ?? [];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => {
      if (!Array.isArray(r)) return null;
      const [date, open, close, high, low, volume] = r;
      if (!date) return null;
      return { date: String(date), open: Number(open), close: Number(close), high: Number(high), low: Number(low), volume: Number(volume) || 0, amount: 0 };
    })
    .filter((k) => k && Number.isFinite(k.close) && k.close > 0);
}

/** 自选池/持仓/决策标的腾讯兜底增量（本地 <30 根或最新日期早于最近交易日时才拉） */
async function syncWatchlistFromTencent(pool, days = 160) {
  const r = await pool.query(
    `SELECT code FROM price_watch WHERE status='active'
     UNION SELECT code FROM logic_ledger WHERE status IN ('验证中','已兑现','已证伪')
     UNION SELECT code FROM decision_post WHERE code IS NOT NULL`,
  );
  const codes = [...new Set(r.rows.map((x) => String(x.code)).filter((c) => /^\d{6}$/.test(c)))];
  let pulled = 0, failed = 0;
  for (const code of codes) {
    try {
      const local = await getLocalKlines(pool, code, 30);
      if (local.length >= 30) continue; // 本地已够，不重复拉
      const rows = await fetchTencentKlines(code, days);
      if (rows.length === 0) { failed++; continue; }
      await upsertKlines(pool, rows.map((x) => ({ code, ...x })), "tencent");
      pulled++;
    } catch {
      failed++;
    }
  }
  console.log(`[klineDb] 自选池腾讯兜底完成 pulled=${pulled} failed=${failed} codes=${codes.length}`);
  return { codes: codes.length, pulled, failed };
}

module.exports = {
  parseTdxDayFile, tdxFileToMeta, upsertKlines, getLocalKlines, getLocalKlinesStrings,
  getLocalMaxDates, importTdxDir, fetchTencentKlines, syncWatchlistFromTencent,
};

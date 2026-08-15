// ============================================================
// server/lib/chainPush.js —— 简报微信推送（任务 10，v9.148.0）
// 触发：cron 交易日早盘前 8:35（简报为前一晚 21:00 生成）
// 内容：6 链简报摘要（阶段+一句话）+ 手机直达链接
// 渠道：复用 routes/push.js sendPushIfConfigured（Server酱=微信扫码绑定，或企微/Bark/飞书）
// ============================================================
const { sendPushIfConfigured } = require("../routes/push");

const CHAIN_NAMES = {
  semiconductor: "半导体", aiCompute: "AI算力", aiPower: "AI电力设备",
  nonferrous: "有色金属", minorMetals: "小金属", robotics: "机器人",
};

function lanUrl() {
  const os = require("os");
  const port = process.env.PORT || 8080;
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const it of list || []) {
      if (it.family === "IPv4" && !it.internal) return `http://${it.address}:${port}/#briefing`;
    }
  }
  return `http://127.0.0.1:${port}/#briefing`;
}

/** 组装 6 链简报摘要文本（每链一行：阶段 + 摘要首句） */
function digestText(briefings) {
  const lines = briefings.map((b) => {
    const name = CHAIN_NAMES[b.chain] ?? b.chain;
    const c = b.content ?? {};
    const stage = c.stage ? `【${c.stage}】` : "";
    const summary = String(c.summary ?? "").replace(/\s+/g, " ").slice(0, 55);
    const fallback = c.fallback ? "（规则兜底）" : "";
    return `▪ ${name}${stage} ${summary}${fallback}`;
  });
  return lines.join("\n");
}

/** 推送简报摘要；未配置渠道时返回 skipped（静默，不阻塞） */
async function pushBriefingDigest(pool) {
  const r = await pool.query(
    `SELECT DISTINCT ON (chain_id) chain_id, briefing_date, content FROM chain_briefing ORDER BY chain_id, briefing_date DESC`,
  );
  if (r.rows.length === 0) return { ok: false, skipped: true, reason: "no briefing" };
  const briefings = r.rows.map((x) => ({ chain: x.chain_id, date: x.briefing_date, content: x.content }));
  const date = briefings[0].date;
  const title = `🔗 产业链简报 ${date}`;
  const body = `${digestText(briefings)}\n\n📱 手机看完整简报（扫码或点开）：\n${lanUrl()}`;
  const out = await sendPushIfConfigured({ title, body, severity: "info" }, pool);
  return { ...out, date, chainCount: briefings.length };
}

module.exports = { pushBriefingDigest, digestText };

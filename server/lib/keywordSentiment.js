// ============================================================
// v9.97.0（批次 2）：舆情词典打分（tinavi keywordSentiment 移植扩展）
// 12+12 → 30+30 财经词表；服务端纯函数：逐词命中 ±1 → positive/negative/neutral
// 窗口统计：近 N 日正/负/中性条数 + 占比 + 趋势（tinavi 未做的增量）
// ============================================================

const POS_WORDS = [
  "增长", "中标", "获批", "新高", "签约", "突破", "盈利", "回购", "增持", "利好", "上涨", "扭亏",
  "涨停", "预增", "超预期", "涨价", "提价", "扩产", "订单", "合作", "战略", "收购", "重组", "降息",
  "补贴", "政策支持", "龙头", "创新高", "翻倍", "净流入", "大单",
];
const NEG_WORDS = [
  "下跌", "亏损", "减持", "诉讼", "处罚", "风险", "下滑", "新低", "质押", "退市", "利空", "下调",
  "跌停", "预亏", "不及预期", "降价", "停产", "召回", "违规", "立案", "被查", "解禁", "爆雷", "加息",
  "限产", "流拍", "破发", "净流出", "裁员", "警示",
];

/** 词典打分：正负词逐词命中 ±1，正>负→positive，负>正→negative，否则 neutral */
function keywordSentiment(text) {
  if (!text) return "neutral";
  let score = 0;
  for (const w of POS_WORDS) if (text.includes(w)) score++;
  for (const w of NEG_WORDS) if (text.includes(w)) score--;
  if (score > 0) return "positive";
  if (score < 0) return "negative";
  return "neutral";
}

/**
 * 舆情窗口统计：近 N 日新闻（按时间过滤）→ { total, positive, negative, neutral,
 *   posRatio, negRatio, trend }（trend：positive 占比 - negative 占比，-1~1）
 * rows: [{ title, time }]，time 为 "YYYY-MM-DD HH:MM:SS" 或 Date 可比较
 */
function sentimentWindowStats(rows, days) {
  const since = new Date(Date.now() + 8 * 3600 * 1000 - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const filtered = (rows || []).filter(r => {
    const t = String(r.time ?? "");
    return t >= since || t.slice(0, 10) >= since;
  });
  let positive = 0, negative = 0, neutral = 0;
  const top = [];
  for (const r of filtered) {
    const sent = keywordSentiment(String(r.title ?? ""));
    if (sent === "positive") positive++;
    else if (sent === "negative") negative++;
    else neutral++;
    if (top.length < 5) top.push(String(r.title).slice(0, 80));
  }
  const total = filtered.length;
  return {
    days,
    total,
    positive,
    negative,
    neutral,
    posRatio: total > 0 ? +(positive / total).toFixed(3) : 0,
    negRatio: total > 0 ? +(negative / total).toFixed(3) : 0,
    trend: total > 0 ? +((positive - negative) / total).toFixed(3) : 0,
    top,
  };
}

module.exports = { keywordSentiment, sentimentWindowStats, POS_WORDS, NEG_WORDS };

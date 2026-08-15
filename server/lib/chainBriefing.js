// ============================================================
// server/lib/chainBriefing.js —— 链简报生成（任务 08，v9.148.0）
// 输入：chain_intel（任务 07 挖掘的原始情报）+ 昨日简报（对比逻辑变化）+ 价格历史
// 输出：LLM 简报 JSON（阶段判断/受益标的含推理链/逻辑变化/关键信号/风险）→ chain_briefing 落库
// 兜底：坏 JSON → parseLLMJSON 容错 → 仍失败重试 1 次 → 规则版（从情报提取 top 条目）
// ============================================================
const { pool } = require("../db");
const { chatComplete } = require("./llmCore");
const { parseLLMJSON } = require("./llmJson");
const { getCommodityPriceHistory } = require("./commodityPrice");

async function ensureChainBriefingTable(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS chain_briefing (
    id SERIAL PRIMARY KEY,
    chain_id TEXT NOT NULL,
    briefing_date TEXT NOT NULL,
    content JSONB NOT NULL,
    model TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(chain_id, briefing_date)
  )`);
}

function bjDateStr(offsetDays = 0) {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** 规则版兜底：情报不足/LLM 失败时，从已验证+单源权威条目提取 top3 组成简报 */
function ruleFallback(chainId, intel) {
  const ranked = [...intel.items]
    .sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0) || (b.singleAuthoritative ? 1 : 0) - (a.singleAuthoritative ? 1 : 0));
  return {
    stage: "未知（情报不足）",
    summary: `今日挖掘到 ${intel.items.length} 条产业链情报，LLM 研判暂不可用，以下为规则版要点（${intel.signals?.length ?? 0} 条站内信号）。`,
    beneficiaries: [],
    logicChange: "无昨日简报可对比（规则版）",
    keySignals: ranked.slice(0, 3).map((i) => ({ text: i.title.slice(0, 80), verified: i.verified })),
    risks: ["LLM 研判不可用，请人工核实来源后决策"],
    fallback: true,
  };
}

/** 生成单链简报（LLM）并落库；返回 {chainId, date, content, fallback} */
async function generateBriefing(db, chainId, { withLLM = true } = {}) {
  const { CHAIN_VARIABLES } = require("./chainVariables");
  const cfg = CHAIN_VARIABLES[chainId];
  if (!cfg) throw new Error(`unknown chain: ${chainId}`);
  await ensureChainBriefingTable(db);

  const intelR = await db.query(
    `SELECT items, people, meta FROM chain_intel WHERE chain_id=$1 ORDER BY id DESC LIMIT 1`,
    [chainId],
  );
  const intel = intelR.rows[0];
  const today = bjDateStr();
  if (!intel) {
    // 无情报：落一条占位简报
    await ensureChainBriefingTable(db);
    const placeholder = { stage: "未扫描", summary: "今晚 21:00 扫描任务尚未运行，无情报可研判。", beneficiaries: [], logicChange: "", keySignals: [], risks: [] };
    await db.query(
      `INSERT INTO chain_briefing(chain_id, briefing_date, content) VALUES($1,$2,$3)
       ON CONFLICT(chain_id, briefing_date) DO UPDATE SET content=$3, created_at=now()`,
      [chainId, today, JSON.stringify(placeholder)],
    );
    return { chainId, date: today, content: placeholder, fallback: true };
  }

  // 昨日简报（对比逻辑变化）
  const prevR = await db.query(
    `SELECT content FROM chain_briefing WHERE chain_id=$1 AND briefing_date=$2 LIMIT 1`,
    [chainId, bjDateStr(-1)],
  );
  const prev = prevR.rows[0]?.content;

  // 价格历史摘要（关联链的百川商品，取涨跌 top）
  let priceBrief = "";
  try {
    const prices = await getCommodityPriceHistory(db, { days: 14 });
    const names = (cfg.variables || []).map((v) => v.commodity).filter(Boolean);
    const lines = [];
    for (const n of names) {
      const seq = prices.byName[n] || [];
      if (seq.length >= 2) {
        const first = seq[seq.length - 1]?.price;
        const last = seq[0]?.price;
        const pct = first && last ? (((last - first) / first) * 100).toFixed(1) : null;
        lines.push(`${n}: ${last}（14日${pct !== null ? pct + "%" : "数据不足"}）`);
      } else if (seq.length === 1) lines.push(`${n}: ${seq[0].price}（仅1日数据）`);
    }
    priceBrief = lines.join("；");
  } catch { /* 价格失败不影响简报 */ }

  // 组装情报摘要（截断控制 token）
  const itemBrief = intel.items.slice(0, 40).map((i) =>
    `[${i.verified ? "已验证" : (i.singleAuthoritative ? "单源权威" : "待验证")}] ${i.title.slice(0, 90)}（${i.sources.join("/").slice(0, 30)}${i.sourceCount > 1 ? `，${i.sourceCount}源` : ""}${i.authoritativeCount ? "，权威" : ""}）`
  ).join("\n");
  const peopleBrief = (intel.people || []).filter((p) => p.items.length > 0).map((p) =>
    `【${p.name}（${p.note || ""}）】${p.items.slice(0, 3).map((x) => x.title.slice(0, 60)).join(" / ")}`
  ).join("\n");
  const signalsBrief = (intel.signals || []).slice(0, 8).map((s) =>
    `${s.node_name}: ${s.signal_type}=${s.value}${s.unit || ""}（${s.direction || ""}，${s.effective_date}）`
  ).join("\n");

  // 历史命中统计（任务 12：简报 prompt 引用"该链历史判断 vs 实际"）
  let hitHistory = "";
  try {
    const { getChainHitHistory } = require("./chainLearning");
    const hits = await getChainHitHistory(db, chainId, { limit: 5 });
    if (hits.length > 0) {
      hitHistory = "\n【该链历史判断命中率（简报日 → T+5 链内标的平均涨跌）】\n" +
        hits.map((h) => `${h.date} 判${h.stage || "?"} → 实际 ${h.avgPct >= 0 ? "+" : ""}${h.avgPct}%（${h.sampleCount} 样本）`).join("\n");
    }
  } catch { /* 命中率失败不影响简报 */ }

  const system = "你是A股产业链投研分析师。基于【今日挖掘情报】对产业链输出简报，规则：1) 只引用情报中出现的证据，禁止编造数据/标的；2) 阶段判断限用：启动/加速/分歧/退潮/冰点；3) 受益标的必须写清产业逻辑推理与证据；4) 输出严格 JSON，不要 markdown 围栏。";
  const user = [
    `产业链：${cfg.name}（${chainId}）`,
    ``,
    `【今日情报（${intel.items.length}条，已验证/单源权威/待验证标记）】`,
    itemBrief.slice(0, 6000),
    peopleBrief ? `\n【关键人物动态】\n${peopleBrief.slice(0, 1500)}` : "",
    signalsBrief ? `\n【站内信号】\n${signalsBrief.slice(0, 1200)}` : "",
    priceBrief ? `\n【产业价格（百川 14 日）】\n${priceBrief}` : "",
    prev ? `\n【昨日简报（对比逻辑变化用）】\n${JSON.stringify(prev).slice(0, 1200)}` : "\n【昨日简报】无（今日为首期）",
    hitHistory,
    ``,
    `请输出 JSON：{"stage":"","summary":"","beneficiaries":[{"name":"","reason":"","evidence":""}],"logicChange":"","keySignals":[{"text":"","verified":true}],"risks":[""]}`,
  ].join("\n");

  let content = null;
  let fallback = false;
  let model = null;
  if (withLLM) {
    try {
      const r = await chatComplete({ system, user, maxTokens: 4000, temperature: 0.2, thinking: true });
      model = r.endpoint != null ? `ep${r.endpoint}` : null;
      content = parseLLMJSON(r.text);
      if (!content) {
        // 坏 JSON：重试一次（length 截断已由 llmCore 处理）
        const r2 = await chatComplete({ system, user, maxTokens: 6000, temperature: 0.2, thinking: true });
        content = parseLLMJSON(r2.text);
      }
    } catch (e) {
      console.warn(`[chainBriefing] ${chainId} LLM 失败:`, e.message);
    }
  }
  if (!content) { content = ruleFallback(chainId, intel); fallback = true; }

  await ensureChainBriefingTable(db);
  await db.query(
    `INSERT INTO chain_briefing(chain_id, briefing_date, content, model) VALUES($1,$2,$3,$4)
     ON CONFLICT(chain_id, briefing_date) DO UPDATE SET content=$3, model=$4, created_at=now()`,
    [chainId, today, JSON.stringify(content), model],
  );
  return { chainId, date: today, content, fallback, itemCount: intel.items.length };
}

/** 6 链全部生成简报（一条失败不阻塞其他） */
async function generateAllBriefings(db = pool, { withLLM = true } = {}) {
  const { CHAIN_VARIABLES } = require("./chainVariables");
  const results = [];
  for (const chainId of Object.keys(CHAIN_VARIABLES)) {
    try {
      const r = await generateBriefing(db, chainId, { withLLM });
      results.push({ chainId, ok: true, fallback: r.fallback, items: r.itemCount ?? 0, stage: r.content?.stage ?? "" });
    } catch (e) {
      results.push({ chainId, ok: false, error: e.message });
    }
  }
  return results;
}

module.exports = { ensureChainBriefingTable, generateBriefing, generateAllBriefings };

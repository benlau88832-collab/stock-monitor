// ============================================================
// v9.145.0（第二轮 P1-4）：产业链传导推理 Agent
// 一次按链推理，结果写入 industry_chain_event，供链上个股决策卡复用。
// ============================================================
const { chatComplete } = require("./llmCore");

function parseJson(text) {
  const start = String(text || "").indexOf("{");
  const end = String(text || "").lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("chain reasoning output not json");
  return JSON.parse(String(text).slice(start, end + 1));
}

async function runChainReasoning(pool, chainId) {
  const chainR = await pool.query(`SELECT id, name, description FROM industry_chain WHERE id=$1`, [chainId]);
  const chain = chainR.rows[0];
  if (!chain) return { ok: false, error: `chain not found: ${chainId}` };

  const nodeR = await pool.query(
    `SELECT id, name, node_role, sequence FROM industry_chain_node WHERE chain_id=$1 ORDER BY sequence`,
    [chainId],
  );
  const nodes = nodeR.rows;
  if (nodes.length === 0) return { ok: true, skipped: true, reason: "no nodes" };

  const signalR = await pool.query(
    `SELECT s.node_id, n.name AS node_name, s.signal_type, s.value, s.unit, s.direction, s.effective_date, s.source_url
     FROM industry_chain_signal s JOIN industry_chain_node n ON n.id=s.node_id
     WHERE n.chain_id=$1 AND s.effective_date >= CURRENT_DATE - 30
     ORDER BY s.effective_date DESC LIMIT 50`,
    [chainId],
  );
  const signals = signalR.rows;
  if (signals.length === 0) return { ok: true, skipped: true, reason: "no signals" };

  const user = `产业链：${chain.name}
节点结构（上游→下游）：${nodes.map((n) => `${n.node_role || ""}:${n.name}`).join(" → ")}
最近30天信号：
${JSON.stringify(signals, null, 2)}

请输出严格JSON：
{
  "impactPath": "一句话概括本轮变化的传导路径",
  "impactedNodes": [
    {"node":"节点名","direction":"受益/受损/中性","reasoning":"引用具体数据的推理过程","confidence":0-100,"evidence":["数据点（来源+日期）"]}
  ],
  "title":"简短事件标题",
  "summary":"2-3句话总结",
  "confidence":0-100
}`;
  const r = await chatComplete({
    system: "你是产业链研究员。每条结论必须引用输入中的具体数据点（数值+日期+来源）；证据不足时直接说“证据不足，暂不判断”。只输出JSON。",
    user,
    maxTokens: 6000,
    temperature: 0.2,
    thinking: true,
  });
  const j = parseJson(r.text);
  const impacted = Array.isArray(j.impactedNodes) ? j.impactedNodes.slice(0, 20) : [];
  const originNodeId = signals[0]?.node_id ?? null;

  const ins = await pool.query(
    `INSERT INTO industry_chain_event(chain_id, origin_node_id, title, summary, impact_path, impacted_nodes, confidence, model_generated)
     VALUES($1,$2,$3,$4,$5,$6,$7,true) RETURNING *`,
    [
      chainId,
      originNodeId,
      String(j.title || `${chain.name}传导推理`).slice(0, 200),
      String(j.summary || "").slice(0, 2000),
      JSON.stringify({ path: String(j.impactPath || "") }),
      JSON.stringify(impacted),
      Math.max(0, Math.min(100, Number(j.confidence) || 50)),
    ],
  );
  return { ok: true, event: ins.rows[0] };
}

module.exports = { runChainReasoning };

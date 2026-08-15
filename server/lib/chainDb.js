// ============================================================
// v9.143.0 chain database layer: seed shared KB into PG and map stocks
// ============================================================
const { pool } = require("../db");
const { CHAIN_KB, locateChain } = require("../../src/shared/transmission-chain.js");
const { getJson } = require("./outbound");
const { syncCommoditySignals } = require("./chainSignals");

async function ensureChainKb(p) {
  const r = await p.query("SELECT count(*)::int AS n FROM industry_chain");
  for (const c of CHAIN_KB) {
    await p.query(
      `INSERT INTO industry_chain(id,name,description) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING`,
      [c.id, c.name, `自动种子：${c.nodes.map((n) => n.name).join(" → ")}`],
    );
    for (let i = 0; i < c.nodes.length; i++) {
      await p.query(
        `INSERT INTO industry_chain_node(chain_id,name,node_role,sequence) VALUES($1,$2,$3,$4) ON CONFLICT(chain_id,name) DO NOTHING`,
        [c.id, c.nodes[i].name, c.nodes[i].keywords?.[0] || "未知", i],
      );
    }
  }
}

async function findBoards(p, code) {
  const candidates = [];
  const [conceptR, ztR] = await Promise.allSettled([
    p.query(`SELECT concepts, all_boards, hybk, core_concept FROM stock_concepts WHERE code=$1`, [code]),
    p.query(`SELECT data FROM zt_snapshot ORDER BY date DESC LIMIT 1`),
  ]);
  if (conceptR.status === "fulfilled" && conceptR.value.rows[0]) {
    const row = conceptR.value.rows[0];
    if (row.core_concept) candidates.push(String(row.core_concept));
    if (row.hybk) candidates.push(String(row.hybk));
    for (const b of Array.isArray(row.all_boards) ? row.all_boards : []) candidates.push(String(b));
    for (const c of Array.isArray(row.concepts) ? row.concepts : []) candidates.push(String(c));
  }
  if (ztR.status === "fulfilled" && ztR.value.rows[0]) {
    const raw = ztR.value.rows[0].data;
    const snap = typeof raw === "string" ? JSON.parse(raw) : raw;
    const arr = Array.isArray(snap) ? snap : snap?.pool ?? [];
    const hit = arr.find((x) => String(x.code ?? x.c ?? "") === code);
    if (hit?.hybk) candidates.push(String(hit.hybk));
  }
  return [...new Set(candidates.filter(Boolean))];
}

async function fetchMainBusiness(code) {
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_FN_MAINOP&columns=ALL&filter=(SECURITY_CODE%3D%22${code}%22)&pageNumber=1&pageSize=40&sortColumns=REPORT_DATE&sortTypes=-1&source=HSF10&client=WEB`;
  try {
    const r = await getJson(url, { timeout: 6000, source: "datacenter" });
    const list = Array.isArray(r.data?.result?.data) ? r.data.result.data : [];
    const latest = String(list[0]?.REPORT_DATE ?? "").slice(0, 10);
    return { reportDate: latest, items: list.filter((x) => String(x.REPORT_DATE).startsWith(latest)).map((x) => ({ name: String(x.ITEM_NAME ?? ""), ratio: Number(x.MBI_RATIO) || 0 })) };
  } catch { return { reportDate: null, items: [] }; }
}
async function mapStockToChain(p, code, boards) {
  for (const b of boards) {
    const hit = locateChain(b);
    if (!hit) continue;
    await ensureChainKb(p);
    const nodeR = await p.query(`SELECT id FROM industry_chain_node WHERE chain_id=$1 AND name=$2 LIMIT 1`, [hit.chain.id, hit.chain.nodes[hit.nodeIdx].name]);
    if (!nodeR.rows[0]) continue;
    const nodeId = nodeR.rows[0].id;
    await p.query(
      `INSERT INTO industry_chain_node_stock(node_id,stock_code,role_note,source) VALUES($1,$2,$3,'auto-kb')
       ON CONFLICT(node_id,stock_code) DO NOTHING`,
      [nodeId, code, `板块匹配：${b}`],
    );
    const mb = await fetchMainBusiness(code);
    const keywords = [...(hit.chain.nodes[hit.nodeIdx].keywords || []), b];
    const preferred = ["电池", "储能", "新能源", "能源", "锂", "光", "电力", "电网"];
    const hitItem = mb.items.find((x) => keywords.some((k) => k && (x.name.includes(k) || k.includes(x.name)))) || preferred.map((k) => mb.items.find((x) => x.name.includes(k))).find(Boolean);
    if (hitItem && hitItem.ratio > 0) {
      await p.query(`UPDATE industry_chain_node_stock SET exposure_pct=$1, role_note=$2, confirmed_at=now() WHERE node_id=$3 AND stock_code=$4`, [Math.round(hitItem.ratio * 10000) / 10000, `主营：${hitItem.name} ${(hitItem.ratio * 100).toFixed(2)}%（${mb.reportDate}）`, nodeId, code]);
    }
    return { nodeId, chainId: hit.chain.id, chainName: hit.chain.name, nodeName: hit.chain.nodes[hit.nodeIdx].name, board: b };
  }
  return null;
}

async function getChainDbContext(p, code) {
  await ensureChainKb(p);
  await syncCommoditySignals(p);
  const boards = await findBoards(p, code);
  const mapped = await mapStockToChain(p, code, boards);
  if (!mapped) return { mapped: false, boards, chain: null };

  const nodeR = await p.query(
    `SELECT n.id,n.chain_id,n.name,n.node_role,n.sequence,c.name AS chain_name
     FROM industry_chain_node n JOIN industry_chain c ON c.id=n.chain_id
     WHERE n.id=$1`, [mapped.nodeId],
  );
  const node = nodeR.rows?.[0];
  const stockR = await p.query(`SELECT exposure_pct,role_note,source,confirmed_at FROM industry_chain_node_stock WHERE node_id=$1 AND stock_code=$2`, [mapped.nodeId, code]);
  const stockMap = stockR.rows?.[0];
  if (!node) return { mapped: false, boards, chain: null };

  const nodesR = await p.query(`SELECT name,sequence FROM industry_chain_node WHERE chain_id=$1 ORDER BY sequence`, [node.chain_id]);
  const nodes = nodesR.rows.map((r) => r.name);
  const idx = nodes.indexOf(node.name);
  const upstream = nodes.slice(0, idx).reverse();
  const downstream = nodes.slice(idx + 1);
  const signalR = await p.query(`SELECT signal_type,value,unit,direction,effective_date,source_url FROM industry_chain_signal WHERE node_id=$1 ORDER BY effective_date DESC LIMIT 20`, [node.id]);

  return {
    mapped: true,
    boards,
    chain: {
      chainId: node.chain_id,
      chainName: node.chain_name,
      boardName: mapped.board,
      nodeIdx: idx,
      nodeName: node.name,
      nodeRole: node.node_role,
      nodes,
      upstream,
      downstream,
      atHead: idx === 0,
      atTail: idx === nodes.length - 1,
      exposurePct: stockMap?.exposure_pct ?? null,
      exposureNote: stockMap?.role_note ?? null,
      signals: signalR.rows,
    },
  };
}

// v9.147.0（重建·对齐 v9.146 接口）：产业链传导事件读取（industry_chain_event 表）
// 供 decisions.js fetchChainContext 使用 —— 一次推理、多票复用的事件上下文
async function loadChainEvents(p, chainId) {
  try {
    const r = await p.query(
      `SELECT id, title, summary, impact_path, impacted_nodes, confidence, model_generated, published_at
       FROM industry_chain_event WHERE chain_id=$1 ORDER BY published_at DESC LIMIT 10`,
      [String(chainId)],
    );
    return r.rows;
  } catch {
    return [];
  }
}

module.exports = { ensureChainKb, mapStockToChain, getChainDbContext, loadChainEvents };

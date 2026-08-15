// ============================================================
// server/lib/chainVariables.js —— 关键变量库与人物种子（任务 06，v9.148.0）
// 目的：给每晚挖掘引擎（任务 07）提供"每条链该搜什么"的靶子配置。
// 结构：6 条链 × 每链 2-3 个关键变量（中英文搜索词 + 关联商品 + 权威源类型）
//       + 关键人物种子名单（AI 周度评估自行扩散新人物）
// 变量定义依据：用户 Q9 确认（半导体/AI算力/AI电力设备/有色/小金属/机器人）+ 公开常识
// ============================================================

/** 6 链关键变量：key 唯一；zh/en 为搜索词；commodity 关联百川商品名（无则留空）；authority 期望权威源类型 */
const CHAIN_VARIABLES = {
  semiconductor: {
    name: "半导体",
    variables: [
      { key: "memory_price", name: "存储芯片价格", zh: "存储芯片 涨价 价格", en: "DRAM NAND price increase", enAlt: "memory chip spot price", commodity: "", authority: "市场研究/现货报价" },
      { key: "foundry_utilization", name: "晶圆厂稼动率", zh: "晶圆代工 稼动率 产能", en: "foundry utilization capacity", enAlt: "TSMC capacity utilization rate", commodity: "", authority: "行业研究/公司指引" },
      { key: "equipment_export", name: "设备订单与出口管制", zh: "半导体设备 出口管制 订单", en: "semiconductor equipment export control order", enAlt: "chip export controls China", commodity: "", authority: "官方公告/行业媒体" },
    ],
  },
  aiCompute: {
    name: "AI算力",
    variables: [
      { key: "hyperscaler_capex", name: "云厂商资本开支", zh: "云厂商 资本开支 AI 投资", en: "hyperscaler capex AI investment", enAlt: "cloud capex guidance 2026", commodity: "", authority: "公司财报/官方公告" },
      { key: "gpu_hbm_supply", name: "GPU/HBM 供给与价格", zh: "GPU HBM 供给 价格", en: "GPU HBM supply price", enAlt: "Nvidia GPU allocation HBM", commodity: "", authority: "市场研究/公司指引" },
      { key: "optical_module", name: "光模块/液冷订单", zh: "光模块 液冷 订单", en: "optical module liquid cooling order", enAlt: "800G optical transceiver demand", commodity: "", authority: "公司公告/行业媒体" },
    ],
  },
  aiPower: {
    name: "AI电力设备",
    variables: [
      { key: "transformer_export", name: "变压器出口订单/价格", zh: "变压器 出口 订单 涨价", en: "transformer export order price", enAlt: "grid equipment export China", commodity: "", authority: "海关数据/公司公告" },
      { key: "grid_investment", name: "电网投资", zh: "电网 投资 特高压 招标", en: "grid investment ultra high voltage", enAlt: "ultra high voltage tenders", commodity: "", authority: "官方公告/招标信息" },
      { key: "datacenter_power", name: "数据中心用电需求", zh: "数据中心 用电 电力需求", en: "data center power demand electricity", enAlt: "AI data center power demand", commodity: "", authority: "行业媒体/官方数据" },
    ],
  },
  nonferrous: {
    name: "有色金属",
    variables: [
      { key: "copper_price", name: "铜价与库存", zh: "铜价 铜 库存", en: "copper price LME inventory", enAlt: "copper inventory LME", commodity: "铜", authority: "交易所/行业报价" },
      { key: "aluminum_price", name: "铝价与库存", zh: "铝价 铝 库存", en: "aluminum price inventory", enAlt: "aluminum inventory LME", commodity: "铝", authority: "交易所/行业报价" },
      { key: "smelting_tc_rc", name: "冶炼加工费 TC/RC", zh: "铜 加工费 TC RC", en: "copper smelting TC RC treatment charge", enAlt: "copper smelting charge", commodity: "", authority: "行业研究" },
    ],
  },
  minorMetals: {
    name: "小金属",
    variables: [
      { key: "antimony_price", name: "锑价", zh: "锑价 锑 涨价", en: "antimony price", enAlt: "antimony export China", commodity: "锑", authority: "行业报价/官方公告" },
      { key: "tungsten_moly", name: "钨/钼价", zh: "钨价 钼价 涨价", en: "tungsten molybdenum price", enAlt: "tungsten molybdenum price", commodity: "钨", authority: "行业报价" },
      { key: "rare_earth_price", name: "稀土价格与政策", zh: "稀土 价格 出口管制 收储", en: "rare earth price export control", enAlt: "rare earth export quota", commodity: "稀土", authority: "官方公告/行业报价" },
    ],
  },
  robotics: {
    name: "机器人",
    variables: [
      { key: "humanoid_production", name: "人形机器人量产节奏", zh: "人形机器人 量产 订单", en: "humanoid robot mass production order", enAlt: "humanoid robot shipment 2026", commodity: "", authority: "公司公告/行业媒体" },
      { key: "core_parts_order", name: "核心零部件（减速器/丝杠/传感器）", zh: "减速器 丝杠 传感器 订单", en: "harmonic reducer ball screw sensor order", enAlt: "harmonic reducer robot orders", commodity: "", authority: "公司公告/行业媒体" },
      { key: "tesla_optimus", name: "特斯拉 Optimus 动态", zh: "特斯拉 Optimus 机器人", en: "Tesla Optimus robot", enAlt: "Optimus robot production update", commodity: "", authority: "官方发布/行业媒体" },
    ],
  },
};

/** 关键人物种子：AI 周度评估可自行扩散新人物（存 kv 后合并） */
const KEY_PEOPLE = [
  { name: "Elon Musk", zh: "马斯克", chains: ["robotics", "aiCompute"], search: "Elon Musk", note: "特斯拉/Optimus/xAI" },
  { name: "Jensen Huang", zh: "黄仁勋", chains: ["aiCompute", "semiconductor"], search: "Jensen Huang Nvidia", note: "英伟达" },
  { name: "Lisa Su", zh: "苏姿丰", chains: ["semiconductor", "aiCompute"], search: "Lisa Su AMD", note: "AMD" },
  { name: "C.C. Wei", zh: "魏哲家", chains: ["semiconductor"], search: "CC Wei TSMC", note: "台积电 CEO" },
  { name: "Mark Zuckerberg", zh: "扎克伯格", chains: ["aiCompute"], search: "Mark Zuckerberg Meta AI capex", note: "Meta 资本开支" },
  { name: "Satya Nadella", zh: "纳德拉", chains: ["aiCompute"], search: "Satya Nadella Microsoft AI", note: "微软资本开支" },
  { name: "Sundar Pichai", zh: "皮查伊", chains: ["aiCompute"], search: "Sundar Pichai Google AI capex", note: "谷歌资本开支" },
  { name: "任正非", zh: "任正非", chains: ["semiconductor", "aiCompute"], search: "任正非 华为", note: "华为" },
];

/** 查询某链的变量配置 */
function getChainVariables(chainId) {
  return CHAIN_VARIABLES[chainId] ?? null;
}

/** 全部变量清单（挖掘引擎每晚遍历用） */
function allVariableTasks() {
  const out = [];
  for (const [chainId, cfg] of Object.entries(CHAIN_VARIABLES)) {
    for (const v of cfg.variables) {
      out.push({ chainId, chainName: cfg.name, variable: v });
    }
  }
  return out;
}

/** 人物清单（含链关联）；v9.148.1（T7 P1-5）：传入 db 时合并用户已采纳的扩散人物 */
async function getKeyPeople(db) {
  const base = KEY_PEOPLE.map((p, i) => ({ id: i + 1, ...p }));
  if (!db) return base;
  try {
    const r = await db.query(`SELECT value FROM kv_store WHERE key='chain_people_confirmed'`);
    const v = r.rows[0]?.value;
    // v9.148.2（A7 P3）：kv __raw typeof 守卫（字符串/对象/数组三种形态安全解析）
    const arr = Array.isArray(v) ? v : (v && typeof v === "object" && typeof v.__raw === "string" ? JSON.parse(v.__raw) : (typeof v === "string" ? JSON.parse(v) : []));
    const names = new Set(base.map((p) => p.name));
    let nextId = base.length + 1;
    for (const p of Array.isArray(arr) ? arr : []) {
      if (!p?.name || names.has(p.name)) continue;
      names.add(p.name);
      base.push({ id: nextId++, name: p.name, zh: p.zh || p.name, chains: Array.isArray(p.chains) ? p.chains : ["aiCompute"], search: p.search || p.name, note: p.note || "用户采纳的扩散人物" });
    }
  } catch { /* 合并失败不影响静态名单 */ }
  return base;
}

/** 建议池（kv chain_people_suggestions，LLM 简报自扩散产出） */
async function getPeopleSuggestions(db) {
  try {
    const r = await db.query(`SELECT value FROM kv_store WHERE key='chain_people_suggestions'`);
    const v = r.rows[0]?.value;
    const arr = Array.isArray(v) ? v : (v && typeof v === "object" && typeof v.__raw === "string" ? JSON.parse(v.__raw) : (typeof v === "string" ? JSON.parse(v) : [])); // v9.148.2（A7 P3）：kv __raw typeof 守卫const arr = Array.isArray(v) ? v : (v ? JSON.parse(typeof v === "string" ? v : (v.__raw || JSON.stringify(v))) : []); typeof v === "object" ? (typeof v.__raw === "string" ? JSON.parse(v.__raw) : (Array.isArray(v) ? v : [])) : (typeof v === "string" ? JSON.parse(v) : []));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/** 追加建议（按 name 去重）；返回最新建议列表 */
async function addPeopleSuggestion(db, suggestion) {
  const list = await getPeopleSuggestions(db);
  if (suggestion?.name && !list.some((x) => x.name === suggestion.name)) {
    list.push({ name: suggestion.name, zh: suggestion.zh || "", chains: Array.isArray(suggestion.chains) ? suggestion.chains : ["aiCompute"], why: suggestion.why || "", suggestedAt: new Date().toISOString() });
  }
  await db.query(
    `INSERT INTO kv_store(key, value, updated_at) VALUES($1,$2,now())
     ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
    ["chain_people_suggestions", JSON.stringify(list)],
  );
  return list;
}

/** 采纳建议：移入 confirmed（幂等），并从建议池移除；v9.148.2（A7 P2-7）：两步写包事务防并发半状态 */
async function confirmPeopleSuggestion(db, name) {
  const list = await getPeopleSuggestions(db);
  const item = list.find((x) => x.name === name);
  if (!item) return { ok: false, reason: "suggestion not found" };
  const confirmed = await getConfirmedPeople(db);
  if (!confirmed.some((x) => x.name === name)) confirmed.push(item);
  try {
    await db.query("BEGIN");
    await db.query(
      `INSERT INTO kv_store(key, value, updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      ["chain_people_confirmed", JSON.stringify(confirmed)],
    );
    await db.query(
      `INSERT INTO kv_store(key, value, updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      ["chain_people_suggestions", JSON.stringify(list.filter((x) => x.name !== name))],
    );
    await db.query("COMMIT");
  } catch (e) {
    try { await db.query("ROLLBACK"); } catch { /* 回滚失败静默 */ }
    throw e;
  }
  return { ok: true, confirmed };
}

async function getConfirmedPeople(db) {
  try {
    const r = await db.query(`SELECT value FROM kv_store WHERE key='chain_people_confirmed'`);
    const v = r.rows[0]?.value;
    const arr = Array.isArray(v) ? v : (v && typeof v === "object" && typeof v.__raw === "string" ? JSON.parse(v.__raw) : (typeof v === "string" ? JSON.parse(v) : [])); // v9.148.2（A7 P3）：kv __raw typeof 守卫const arr = Array.isArray(v) ? v : (v ? JSON.parse(typeof v === "string" ? v : (v.__raw || JSON.stringify(v))) : []); typeof v === "object" ? (typeof v.__raw === "string" ? JSON.parse(v.__raw) : (Array.isArray(v) ? v : [])) : (typeof v === "string" ? JSON.parse(v) : []));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

module.exports = { CHAIN_VARIABLES, KEY_PEOPLE, getChainVariables, allVariableTasks, getKeyPeople, getPeopleSuggestions, addPeopleSuggestion, confirmPeopleSuggestion, getConfirmedPeople };

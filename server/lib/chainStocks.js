// ============================================================
// server/lib/chainStocks.js —— 6 链 × 标的集合（任务 04，v9.148.0）
// 目的：为产业链简报（任务05+）与异动监控（任务11）提供"链 → 股票集合"的服务端查询。
// 数据来源：stock_concepts 表（东财概念 424 个 / 414 只股票的概念数组 + hybk 行业）。
// 校准结论（2026-08-15 实测）：
//   - 半导体/AI算力/AI电力设备/机器人：现有概念覆盖充分，直接聚合
//   - 有色金属：概念缺失（无铜/铝概念，仅 工业金属 hybk 5 只 + 黄金 11 只）→ 种子名单兜底
//   - 小金属：概念可用（小金属概念 16 只）→ 种子名单补充锑/钨/钼关键标的
// 用法：getChainStocks('semiconductor') → [{code, name, concepts}]（概念命中优先，种子兜底去重）
// ============================================================
const { pool } = require("../db");

/** 6 条链配置：id → { name, concepts: 概念关键词[], hybk: 行业关键词[], seeds: 关键标的手动补充 } */
// 说明：stock_concepts 为按需采集（仅 414 只），种子名单补齐全市场关键标的（按公开常识核对，2026-08-15）
const CHAINS = {
  semiconductor: {
    name: "半导体",
    concepts: ["半导体", "芯片", "存储", "第三代半导体", "先进封装", "集成电路"],
    hybk: ["半导体"],
    seeds: [
      { code: "688012", name: "中微公司" },   // 刻蚀设备
      { code: "002371", name: "北方华创" },   // 设备龙头
      { code: "603501", name: "韦尔股份" },   // CIS 设计
      { code: "688041", name: "海光信息" },   // CPU/DCU
      { code: "603986", name: "兆易创新" },   // 存储/NOR
      { code: "688008", name: "澜起科技" },   // 内存接口
      { code: "600584", name: "长电科技" },   // 封测龙头
    ],
  },
  aiCompute: {
    name: "AI算力",
    concepts: ["算力", "数据中心", "液冷", "PCB", "CPO", "铜缆高速连接", "光通信模块", "服务器"],
    hybk: [],
    seeds: [
      { code: "688041", name: "海光信息" },   // AI 芯片
      { code: "000977", name: "浪潮信息" },   // AI 服务器
      { code: "603019", name: "中科曙光" },   // 算力服务器
      { code: "002837", name: "英维克" },     // 液冷
      { code: "300394", name: "天孚通信" },   // 光器件
      { code: "002281", name: "光迅科技" },   // 光模块
      { code: "002463", name: "沪电股份" },   // PCB/AI 板
      { code: "600183", name: "生益科技" },   // 覆铜板
    ],
  },
  aiPower: {
    name: "AI电力设备",
    concepts: ["电力设备", "电网", "智能电网", "特高压", "变压器"],
    hybk: ["电网设备"],
    seeds: [
      { code: "600089", name: "特变电工" },   // 变压器出海
      { code: "600312", name: "平高电气" },   // 高压开关
      { code: "600406", name: "国电南瑞" },   // 电网自动化
      { code: "002028", name: "思源电气" },   // 开关/出海
      { code: "000400", name: "许继电气" },   // 特高压设备
      { code: "601126", name: "四方股份" },   // 电网二次设备
      { code: "688676", name: "金盘科技" },   // 干变/数据中心
      { code: "002922", name: "伊戈尔" },     // 变压器出海
    ],
  },
  nonferrous: {
    name: "有色金属",
    // 概念体系缺铜/铝概念（2026-08-15 实测），且"铜"子串会误匹配"铜缆高速连接"（算力链）→
    // 只取精确概念"黄金概念"，铜铝靠 hybk 工业金属 + 种子兜底
    concepts: ["黄金概念"],
    hybk: ["工业金属", "有色"],
    // 关键标的手动兜底（按公开常识核对）
    seeds: [
      { code: "601899", name: "紫金矿业" },   // 铜金龙头
      { code: "600362", name: "江西铜业" },   // 铜
      { code: "603993", name: "洛阳钼业" },   // 铜钴钼
      { code: "000630", name: "铜陵有色" },   // 铜
      { code: "601600", name: "中国铝业" },   // 铝
      { code: "000807", name: "云铝股份" },   // 铝
      { code: "002532", name: "天山铝业" },   // 铝
      { code: "600547", name: "山东黄金" },   // 黄金
      { code: "600489", name: "中金黄金" },   // 黄金
      { code: "601168", name: "西部矿业" },   // 铜铅锌
      { code: "600219", name: "南山铝业" },   // 铝
      { code: "000960", name: "锡业股份" },   // 锡
      { code: "000060", name: "中金岭南" },   // 铅锌
      { code: "603799", name: "华友钴业" },   // 钴
    ],
  },
  minorMetals: {
    name: "小金属",
    concepts: ["小金属", "稀土", "稀缺资源", "锑", "钨", "钼"],
    hybk: ["小金属"],
    seeds: [
      { code: "601020", name: "华钰矿业" },   // 锑
      { code: "000426", name: "兴业银锡" },   // 锡锑
      { code: "600549", name: "厦门钨业" },   // 钨
      { code: "002378", name: "章源钨业" },   // 钨
      { code: "601958", name: "金钼股份" },   // 钼
      { code: "600111", name: "北方稀土" },   // 稀土
      { code: "000657", name: "中钨高新" },   // 钨
      { code: "002428", name: "云南锗业" },   // 锗
      { code: "600459", name: "贵研铂业" },   // 铂族
    ],
  },
  robotics: {
    name: "机器人",
    concepts: ["机器人", "人形机器人", "减速器", "传感器", "执行器"],
    hybk: [],
    seeds: [
      { code: "300124", name: "汇川技术" },   // 伺服/控制器
      { code: "688017", name: "绿的谐波" },   // 谐波减速器
      { code: "002472", name: "双环传动" },   // RV 减速器
      { code: "603728", name: "鸣志电器" },   // 步进电机
      { code: "300580", name: "贝斯特" },     // 丝杠
      { code: "601689", name: "拓普集团" },   // 执行器总成
      { code: "300024", name: "机器人" },     // 工业机器人本体
      { code: "688165", name: "埃夫特" },     // 工业机器人
    ],
  },
};

/** 查询单链标的集合：概念命中 + hybk 命中 + 种子兜底，去重排序
 * @param {object} [deps._pool] 测试注入（默认 db pool）
 */
async function getChainStocks(chainId, { limit = 500 } = {}, deps = {}) {
  const cfg = CHAINS[chainId];
  if (!cfg) throw new Error(`unknown chain: ${chainId}`);
  const db = deps._pool || pool;
  const out = new Map();
  // 1) 概念命中（concepts 数组含任一关键词）
  if (cfg.concepts.length) {
    const like = cfg.concepts.map((c) => `concepts::text LIKE '%${c}%'`).join(" OR ");
    const r = await db.query(
      `SELECT code, concepts FROM stock_concepts WHERE (${like}) ORDER BY updated_at DESC LIMIT $1`,
      [limit]
    );
    for (const row of r.rows) {
      if (!out.has(row.code)) out.set(row.code, { code: row.code, concepts: row.concepts ?? [] });
    }
  }
  // 2) hybk 行业命中
  if (cfg.hybk.length) {
    const like = cfg.hybk.map((h) => `hybk LIKE '%${h}%'`).join(" OR ");
    const r = await db.query(
      `SELECT code, concepts FROM stock_concepts WHERE hybk IS NOT NULL AND (${like}) LIMIT $1`,
      [limit]
    );
    for (const row of r.rows) {
      if (!out.has(row.code)) out.set(row.code, { code: row.code, concepts: row.concepts ?? [] });
    }
  }
  // 3) 种子兜底（概念体系缺漏的关键标的）
  for (const s of cfg.seeds) {
    if (!out.has(s.code)) out.set(s.code, { code: s.code, concepts: [], seed: s.name });
  }
  return [...out.values()].slice(0, limit);
}

/** 6 链标的数量统计（校准报告用）
 * @param {object} [deps._pool] 测试注入
 */
async function chainStockStats(deps = {}) {
  const stats = {};
  for (const [id, cfg] of Object.entries(CHAINS)) {
    const stocks = await getChainStocks(id, { limit: 1000 }, deps);
    stats[id] = { name: cfg.name, count: stocks.length, concepts: cfg.concepts, seeds: cfg.seeds.length };
  }
  return stats;
}

module.exports = { CHAINS, getChainStocks, chainStockStats };

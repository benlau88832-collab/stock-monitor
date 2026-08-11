// ============================================================
// src/shared/overseas-map.js —— 外围→A股 映射表（T-D1，v9.103.0）
// 纯 ESM（与 concept-groups.js v9.89.0 同模式：项目根 type:module，服务端 require(ESM) 返回 namespace；
// 前端 vite 原生 ESM；vitest 直接 import）
// 结构：{ source(外盘标的/事件源), aBoard(映射A股板块), stocks(标的池), chain(传导链),
//         weight(强度权重 0-1), lag(时滞), confidence(置信度), kws(匹配关键词) }
// 说明：无权威公开映射表（搜索实证），本表为自建实证 + 持续人工校准；
//       首批 20+ 条（AXT→云南锗业为搜索实证链：AXT 磷化铟衬底→锗需求→云南锗业）
// 匹配：matchOverseas(text) —— 关键词子串命中（大小写不敏感），返回命中项数组
// ============================================================

export const OVERSEAS_MAP = [
  // ---- 美股个股/行业 ----
  { source: "AXT Inc", aBoard: "锗概念/半导体材料", stocks: ["云南锗业", "驰宏锌锗", "中金岭南"], chain: "AXT 磷化铟/锗衬底需求 → 锗价 → 云南锗业", weight: 0.8, lag: "隔夜→次日开盘", confidence: "高", kws: ["AXT", "磷化铟", "锗衬底"] },
  { source: "英伟达 NVDA", aBoard: "CPO/光模块/算力", stocks: ["中际旭创", "新易盛", "天孚通信", "工业富联"], chain: "AI 算力需求 → 光模块/CPO → 中际旭创", weight: 0.9, lag: "隔夜→次日", confidence: "高", kws: ["英伟达", "NVDA", "nvidia", "GPU", "算力"] },
  { source: "美光 MU", aBoard: "存储芯片", stocks: ["兆易创新", "佰维存储", "江波龙"], chain: "存储涨价周期 → 存储芯片 → 兆易创新", weight: 0.7, lag: "隔夜→次日", confidence: "中", kws: ["美光", "micron", "存储", "HBM"] },
  { source: "苹果 AAPL", aBoard: "果链/消费电子", stocks: ["立讯精密", "歌尔股份", "蓝思科技", "东山精密"], chain: "苹果新品/销量 → 供应链 → 立讯精密", weight: 0.7, lag: "隔夜→次日", confidence: "中", kws: ["苹果", "apple", "果链"] },
  { source: "特斯拉 TSLA", aBoard: "汽零/机器人", stocks: ["拓普集团", "三花智控", "旭升集团"], chain: "特斯拉销量/机器人 → 汽零供应链 → 拓普集团", weight: 0.7, lag: "隔夜→次日", confidence: "中", kws: ["特斯拉", "tesla", "马斯克", "人形机器人"] },
  { source: "阿斯麦 ASML", aBoard: "半导体设备/光刻机", stocks: ["北方华创", "中微公司", "拓荆科技"], chain: "先进制程设备需求 → 国产设备替代 → 北方华创", weight: 0.6, lag: "隔夜→次日", confidence: "中", kws: ["阿斯麦", "ASML", "光刻机"] },
  { source: "台积电 TSM", aBoard: "半导体/先进封装", stocks: ["长电科技", "通富微电", "甬矽电子"], chain: "先进制程订单 → 封测 → 长电科技", weight: 0.7, lag: "隔夜→次日", confidence: "中", kws: ["台积电", "tsmc", "先进封装", "CoWoS"] },
  { source: "AMD", aBoard: "算力/CPU", stocks: ["海光信息", "龙芯中科"], chain: "AI 芯片竞争 → 国产 CPU/GPU → 海光信息", weight: 0.6, lag: "隔夜→次日", confidence: "中", kws: ["AMD", "MI300", "MI350"] },
  { source: "博通 AVGO", aBoard: "算力/定制芯片", stocks: ["寒武纪", "海光信息"], chain: "定制 ASIC 需求 → 国产 AI 芯片 → 寒武纪", weight: 0.6, lag: "隔夜→次日", confidence: "中", kws: ["博通", "broadcom", "ASIC"] },
  { source: "微软 MSFT", aBoard: "AI 应用/云计算", stocks: ["金山办公", "科大讯飞", "恒生电子"], chain: "AI 资本开支 → 国产 AI 应用 → 金山办公", weight: 0.5, lag: "隔夜→次日", confidence: "中", kws: ["微软", "microsoft", "openai"] },
  { source: "Meta", aBoard: "AI 应用/算力", stocks: ["昆仑万维", "万兴科技"], chain: "Meta 开源模型/AI 应用 → 国产 AI 应用 → 昆仑万维", weight: 0.5, lag: "隔夜→次日", confidence: "中", kws: ["Meta", "facebook", "llama", "元宇宙"] },
  { source: "高通 QCOM", aBoard: "手机芯片/端侧 AI", stocks: ["中科创达", "韦尔股份"], chain: "端侧 AI 芯片 → 手机链 → 中科创达", weight: 0.5, lag: "隔夜→次日", confidence: "中", kws: ["高通", "qualcomm", "骁龙", "端侧AI"] },
  { source: "中概股 KWEB", aBoard: "互联网/平台经济", stocks: ["阿里巴巴", "腾讯控股", "美团"], chain: "中概情绪 → 港股/互联网 → 腾讯", weight: 0.6, lag: "隔夜→次日", confidence: "中", kws: ["中概股", "KWEB", "恒生科技", "纳斯达克中国"] },
  // ---- 大宗/宏观 ----
  { source: "美债收益率", aBoard: "黄金/成长股", stocks: ["山东黄金", "紫金矿业", "中金黄金"], chain: "美债收益率下行 → 实际利率↓ → 黄金↑", weight: 0.7, lag: "隔夜→次日", confidence: "中", kws: ["美债", "10年期", "实际利率", "收益率"] },
  { source: "原油 WTI", aBoard: "油服/化工", stocks: ["中海油服", "中曼石油", "中国石油"], chain: "油价上涨 → 油服资本开支 → 中海油服", weight: 0.6, lag: "隔夜→次日", confidence: "中", kws: ["原油", "WTI", "布伦特", "油价"] },
  { source: "比特币 BTC", aBoard: "数字货币/算力", stocks: ["润泽科技", "中科曙光"], chain: "BTC 大涨 → 矿机/算力 → 中科曙光", weight: 0.5, lag: "隔夜→次日", confidence: "低", kws: ["比特币", "BTC", "加密货币"] },
  { source: "美元指数 DXY", aBoard: "有色/出口链", stocks: ["紫金矿业", "洛阳钼业"], chain: "美元走弱 → 大宗商品 → 紫金矿业", weight: 0.5, lag: "隔夜→次日", confidence: "中", kws: ["美元指数", "DXY", "美元走弱"] },
  { source: "VIX 恐慌指数", aBoard: "整体风险（防御）", stocks: ["红利低波", "黄金"], chain: "VIX 飙升 → 风险偏好↓ → 防御", weight: 0.6, lag: "当日", confidence: "中", kws: ["VIX", "恐慌指数", "波动率"] },
  { source: "黄金 COMEX", aBoard: "黄金股", stocks: ["山东黄金", "紫金矿业", "湖南黄金"], chain: "金价上涨 → 黄金股 → 山东黄金", weight: 0.7, lag: "隔夜→次日", confidence: "高", kws: ["黄金", "金价", "COMEX", "贵金属"] },
  { source: "铜 LME", aBoard: "铜/有色", stocks: ["紫金矿业", "江西铜业", "洛阳钼业"], chain: "铜价上涨 → 铜矿 → 紫金矿业", weight: 0.6, lag: "隔夜→次日", confidence: "中", kws: ["铜价", "LME铜", "沪铜"] },
  { source: "天然气", aBoard: "燃气/化工", stocks: ["新奥股份", "广汇能源"], chain: "气价上涨 → 燃气 → 新奥股份", weight: 0.5, lag: "隔夜→次日", confidence: "低", kws: ["天然气", "LNG", "气价"] },
  { source: "铀/核电", aBoard: "核电/铀矿", stocks: ["中国核电", "中广核矿业"], chain: "铀价上涨 → 核电 → 中国核电", weight: 0.5, lag: "隔夜→次日", confidence: "低", kws: ["铀", "核电", "SMR"] },
  { source: "稀土", aBoard: "稀土永磁", stocks: ["北方稀土", "金力永磁"], chain: "稀土管制/涨价 → 稀土永磁 → 北方稀土", weight: 0.7, lag: "隔夜→次日", confidence: "高", kws: ["稀土", "镨钕", "磁材"] },
  { source: "锂", aBoard: "锂矿/电池", stocks: ["赣锋锂业", "天齐锂业", "宁德时代"], chain: "锂价反弹 → 锂矿 → 赣锋锂业", weight: 0.6, lag: "隔夜→次日", confidence: "中", kws: ["锂价", "碳酸锂", "锂矿"] },
  { source: "美股 AI 板块", aBoard: "算力链", stocks: ["工业富联", "中科曙光", "浪潮信息"], chain: "美股 AI 资本开支 → 算力硬件 → 工业富联", weight: 0.7, lag: "隔夜→次日", confidence: "中", kws: ["美股AI", "纳指AI", "AI资本开支"] },
];

/**
 * 匹配外盘事件/标的名 → 映射项（大小写不敏感，关键词子串命中）
 * @param text 事件文本或标的名称（如 "AXT 大涨"、"英伟达财报"）
 * @returns 命中项数组（按权重降序）
 */
export function matchOverseas(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return [];
  const hits = OVERSEAS_MAP.filter(m =>
    m.kws.some(k => t.includes(String(k).toLowerCase()))
  );
  return hits.sort((a, b) => b.weight - a.weight);
}

// 纯 ESM 导出（OVERSEAS_MAP / matchOverseas）

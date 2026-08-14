// ============================================================
// v9.143.0 shared chain KB: single source for both frontend/server
// Ported from src/lib/transmissionChain.ts
// ============================================================

export const CHAIN_KB = [
  {
    id: "lithium", name: "锂电产业链",
    nodes: [
      { name: "上游：锂矿/资源", keywords: ["能源金属", "锂矿", "盐湖提锂"] },
      { name: "中游：电池材料", keywords: ["电池材料", "正极", "负极", "电解液", "隔膜"] },
      { name: "中游：电池制造", keywords: ["电池", "储能"] },
      { name: "下游：整车/应用", keywords: ["汽车整车", "新能源车", "汽车零部件"] },
    ],
  },
  {
    id: "solar", name: "光伏产业链",
    nodes: [
      { name: "上游：硅料/硅片", keywords: ["硅料", "多晶硅", "硅片", "工业硅"] },
      { name: "中游：电池/组件", keywords: ["光伏设备", "光伏", "组件", "电池片"] },
      { name: "下游：电站/电网", keywords: ["电力", "电网设备", "绿电", "电站"] },
    ],
  },
  {
    id: "copper", name: "铜产业链",
    nodes: [
      { name: "上游：铜矿", keywords: ["工业金属", "有色", "铜矿", "采掘"] },
      { name: "中游：冶炼/加工", keywords: ["铜", "冶炼", "加工", "铜箔"] },
      { name: "下游：电力/家电/汽车", keywords: ["电网设备", "电力", "家电", "汽车零部件", "电子"] },
    ],
  },
  {
    id: "semiconductor", name: "半导体产业链",
    nodes: [
      { name: "上游：设备/材料", keywords: ["半导体设备", "光刻", "材料"] },
      { name: "中游：设计/制造/封测", keywords: ["半导体", "芯片", "集成电路"] },
      { name: "下游：终端应用", keywords: ["消费电子", "通信设备", "软件", "AI"] },
    ],
  },
  {
    id: "steel", name: "钢铁产业链",
    nodes: [
      { name: "上游：铁矿/焦煤", keywords: ["煤炭", "铁矿", "焦煤", "采掘"] },
      { name: "中游：钢铁冶炼", keywords: ["钢铁", "特钢", "粗钢"] },
      { name: "下游：地产/机械/汽车", keywords: ["房地产", "机械设备", "汽车整车", "建筑"] },
    ],
  },
  {
    id: "petrochem", name: "石油化工产业链",
    nodes: [
      { name: "上游：原油", keywords: ["石油", "原油", "油气"] },
      { name: "中游：炼化/基础化工", keywords: ["化学原料", "炼化", "基础化工"] },
      { name: "下游：精细化工/消费", keywords: ["化学制品", "塑料", "化纤", "农药", "化肥"] },
    ],
  },
  {
    id: "pig", name: "生猪产业链",
    nodes: [
      { name: "上游：饲料/种猪", keywords: ["饲料", "种猪", "玉米", "豆粕"] },
      { name: "中游：养殖", keywords: ["农牧饲渔", "生猪", "养殖", "猪肉"] },
      { name: "下游：屠宰/食品", keywords: ["食品饮料", "屠宰", "肉制品"] },
    ],
  },
  {
    id: "gold", name: "贵金属产业链",
    nodes: [
      { name: "上游：金矿/银矿", keywords: ["贵金属", "黄金", "白银", "金矿"] },
      { name: "下游：珠宝/投资/电子", keywords: ["珠宝", "消费电子", "电子"] },
    ],
  },
  {
    id: "wind", name: "风电产业链",
    nodes: [
      { name: "上游：铸件/叶片材料", keywords: ["风电", "叶片", "铸件", "玻纤"] },
      { name: "中游：整机", keywords: ["风电设备", "风机"] },
      { name: "下游：运营商/电网", keywords: ["电力", "电网设备", "绿电"] },
    ],
  },
  {
    id: "power", name: "电力产业链",
    nodes: [
      { name: "上游：燃料/设备", keywords: ["煤炭", "光伏设备", "风电设备", "燃气"] },
      { name: "中游：发电", keywords: ["电力", "绿电", "火电", "水电"] },
      { name: "下游：电网/用电", keywords: ["电网设备", "特高压", "数据中心", "电解铝"] },
    ],
  },

  {
    id: "ai-hardware", name: "AI算力硬件产业链",
    nodes: [
      { name: "上游：芯片/设备", keywords: ["半导体", "芯片", "光刻", "GPU", "算力芯片", "存储芯片"] },
      { name: "中游：光模块/服务器/PCB", keywords: ["光模块", "CPO", "通信设备", "服务器", "PCB", "铜缆高速连接"] },
      { name: "下游：数据中心/云", keywords: ["数据中心", "云计算", "液冷", "IDC"] },
    ],
  },
  {
    id: "ai-app", name: "AI应用产业链",
    nodes: [
      { name: "上游：模型/数据", keywords: ["AI", "大模型", "数据要素", "算法"] },
      { name: "中游：软件/工具", keywords: ["软件开发", "IT服务", "办公软件", "网络安全"] },
      { name: "下游：应用/端侧", keywords: ["AI应用", "消费电子", "机器人", "传媒", "游戏"] },
    ],
  },
  {
    id: "robot", name: "机器人产业链",
    nodes: [
      { name: "上游：减速器/伺服/传感器", keywords: ["减速器", "伺服", "传感器", "电机"] },
      { name: "中游：本体/控制器", keywords: ["机器人", "工业机器人", "控制器"] },
      { name: "下游：应用场景", keywords: ["智能制造", "汽车整车", "3C", "物流"] },
    ],
  },
  {
    id: "innovative-drug", name: "创新药/CXO产业链",
    nodes: [
      { name: "上游：研发服务", keywords: ["CXO", "CRO", "CDMO", "医药外包"] },
      { name: "中游：创新药", keywords: ["创新药", "生物制品", "化学制药"] },
      { name: "下游：销售/医疗服务", keywords: ["医药商业", "医疗服务", "医疗器械"] },
    ],
  },
  {
    id: "defense-lowalt", name: "军工/低空经济产业链",
    nodes: [
      { name: "上游：材料/元器件", keywords: ["军工", "航空材料", "电子元器件"] },
      { name: "中游：整机/系统", keywords: ["航空装备", "低空经济", "无人机", "航天"] },
      { name: "下游：运营/应用", keywords: ["机场", "物流", "应急"] },
    ],
  },
  {
    id: "consumer-export", name: "消费出海产业链",
    nodes: [
      { name: "上游：制造/供应链", keywords: ["小家电", "纺织制造", "跨境电商", "轻工制造"] },
      { name: "下游：品牌/渠道", keywords: ["电商", "品牌", "海外", "商贸零售"] },
    ],
  },
  {
    id: "data-security", name: "数据要素/信创产业链",
    nodes: [
      { name: "上游：基础软硬件", keywords: ["信创", "国产软件", "操作系统", "数据库"] },
      { name: "中游：数据服务", keywords: ["数据要素", "大数据", "云计算", "IT服务"] },
      { name: "下游：行业应用", keywords: ["政务", "金融科技", "网络安全"] },
    ],
  },
  {
    id: "smart-driving", name: "智能驾驶产业链",
    nodes: [
      { name: "上游：传感器/芯片", keywords: ["激光雷达", "摄像头", "车载芯片", "传感器"] },
      { name: "中游：智驾方案/域控", keywords: ["智能驾驶", "汽车电子", "域控制器", "线控"] },
      { name: "下游：整车/运营", keywords: ["汽车整车", "新能源车", "汽车零部件"] },
    ],
  },
  {
    id: "consumer-electronics", name: "消费电子产业链",
    nodes: [
      { name: "上游：芯片/面板", keywords: ["消费电子", "芯片", "面板", "半导体"] },
      { name: "中游：模组/组装", keywords: ["消费电子零部件", "光学元件", "声学", "结构件"] },
      { name: "下游：品牌/终端", keywords: ["手机", "PC", "可穿戴", "AI眼镜"] },
    ],
  },
  {
    id: "storage", name: "存储产业链",
    nodes: [
      { name: "上游：设备/材料", keywords: ["半导体设备", "存储材料", "光刻"] },
      { name: "中游：制造/封测", keywords: ["存储芯片", "DRAM", "NAND", "封装"] },
      { name: "下游：服务器/终端", keywords: ["服务器", "数据中心", "消费电子"] },
    ],
  },
  {
    id: "optical-comm", name: "光通信产业链",
    nodes: [
      { name: "上游：芯片/材料", keywords: ["光芯片", "光器件", "光材料"] },
      { name: "中游：模块/设备", keywords: ["光模块", "CPO", "通信设备"] },
      { name: "下游：运营商/云", keywords: ["通信服务", "数据中心", "云计算"] },
    ],
  },
  {
    id: "liquid-cooling", name: "液冷产业链",
    nodes: [
      { name: "上游：材料/泵阀", keywords: ["液冷", "冷却液", "泵", "阀"] },
      { name: "中游：冷板/系统", keywords: ["液冷板", "温控", "服务器散热"] },
      { name: "下游：数据中心", keywords: ["数据中心", "IDC", "算力"] },
    ],
  },
  {
    id: "compute-service", name: "算力服务产业链",
    nodes: [
      { name: "上游：芯片/服务器", keywords: ["算力芯片", "GPU", "服务器", "AI芯片"] },
      { name: "中游：IDC/云", keywords: ["IDC", "数据中心", "云计算", "智算中心"] },
      { name: "下游：模型/应用", keywords: ["大模型", "AI应用", "AI"] },
    ],
  },
  {
    id: "machine-tool", name: "工业母机产业链",
    nodes: [
      { name: "上游：数控/刀具", keywords: ["数控系统", "刀具", "机床零部件"] },
      { name: "中游：整机", keywords: ["工业母机", "机床", "加工中心"] },
      { name: "下游：制造", keywords: ["智能制造", "汽车零部件", "航空航天"] },
    ],
  },
  {
    id: "satellite", name: "卫星互联网产业链",
    nodes: [
      { name: "上游：卫星制造", keywords: ["卫星", "火箭", "卫星制造"] },
      { name: "中游：地面站/终端", keywords: ["卫星互联网", "地面站", "相控阵"] },
      { name: "下游：应用", keywords: ["通信", "导航", "遥感"] },
    ],
  },
  {
    id: "nuclear", name: "核电/核聚变产业链",
    nodes: [
      { name: "上游：燃料/材料", keywords: ["核电", "铀", "核材料"] },
      { name: "中游：设备/工程", keywords: ["核岛", "核电设备", "核工程"] },
      { name: "下游：发电", keywords: ["电力", "绿电", "可控核聚变"] },
    ],
  },
  {
    id: "solid-battery", name: "固态电池产业链",
    nodes: [
      { name: "上游：材料", keywords: ["固态电解质", "硫化物", "氧化物"] },
      { name: "中游：电芯", keywords: ["固态电池", "电池", "电芯"] },
      { name: "下游：整车/储能", keywords: ["新能源车", "储能", "汽车整车"] },
    ],
  },
  {
    id: "hydrogen", name: "氢能产业链",
    nodes: [
      { name: "上游：制氢", keywords: ["电解槽", "绿氢", "制氢"] },
      { name: "中游：储运/加注", keywords: ["储氢", "运氢", "加氢"] },
      { name: "下游：燃料电池/应用", keywords: ["燃料电池", "氢能", "商用车"] },
    ],
  },
  {
    id: "energy-storage", name: "储能产业链",
    nodes: [
      { name: "上游：电池/材料", keywords: ["储能", "电池", "正极", "负极"] },
      { name: "中游：PCS/系统", keywords: ["储能变流器", "PCS", "储能系统"] },
      { name: "下游：电网/应用", keywords: ["电网设备", "电力", "新能源"] },
    ],
  },
  {
    id: "grid", name: "电网/特高压产业链",
    nodes: [
      { name: "上游：设备", keywords: ["特高压", "变压器", "开关"] },
      { name: "中游：线路/工程", keywords: ["电网设备", "电网", "电缆"] },
      { name: "下游：电力/用电", keywords: ["电力", "数据中心", "电解铝"] },
    ],
  },
  {
    id: "real-estate", name: "地产产业链",
    nodes: [
      { name: "上游：土地/资金", keywords: ["土地", "房地产", "地产"] },
      { name: "中游：开发/建筑", keywords: ["房地产开发", "建筑", "装修"] },
      { name: "下游：家电/物业", keywords: ["家电", "物业", "建材"] },
    ],
  },
  {
    id: "infrastructure", name: "基建产业链",
    nodes: [
      { name: "上游：材料/机械", keywords: ["水泥", "钢铁", "工程机械"] },
      { name: "中游：工程", keywords: ["基建", "建筑", "铁路"] },
      { name: "下游：运营", keywords: ["交通", "公用事业", "港口"] },
    ],
  },
  {
    id: "liquor", name: "白酒产业链",
    nodes: [
      { name: "上游：粮食/包装", keywords: ["粮食", "包装"] },
      { name: "中游：酿造", keywords: ["白酒", "酿酒", "酒"] },
      { name: "下游：渠道/消费", keywords: ["食品饮料", "零售", "消费"] },
    ],
  },
  {
    id: "food", name: "食品饮料产业链",
    nodes: [
      { name: "上游：农业/原料", keywords: ["农业", "种植", "原料"] },
      { name: "中游：加工", keywords: ["食品加工", "饮料", "调味"] },
      { name: "下游：渠道/消费", keywords: ["食品饮料", "零售", "消费"] },
    ],
  },
  {
    id: "medical-device", name: "医疗器械产业链",
    nodes: [
      { name: "上游：核心部件", keywords: ["医疗器械", "影像", "耗材"] },
      { name: "中游：设备/IVD", keywords: ["医疗设备", "体外诊断", "高值耗材"] },
      { name: "下游：医疗服务", keywords: ["医疗服务", "医院", "康复"] },
    ],
  },
  {
    id: "tcm", name: "中药产业链",
    nodes: [
      { name: "上游：药材", keywords: ["中药材", "中药饮片"] },
      { name: "中游：制药", keywords: ["中药", "中成药", "中医药"] },
      { name: "下游：零售/医院", keywords: ["医药商业", "药店", "医疗服务"] },
    ],
  },
  {
    id: "rare-earth", name: "稀土永磁产业链",
    nodes: [
      { name: "上游：稀土矿", keywords: ["稀土", "稀土矿"] },
      { name: "中游：冶炼/磁材", keywords: ["稀土永磁", "磁材", "钕铁硼"] },
      { name: "下游：电机/新能源", keywords: ["新能源车", "风电", "机器人", "电机"] },
    ],
  },
  {
    id: "aluminum", name: "铝产业链",
    nodes: [
      { name: "上游：铝土矿", keywords: ["铝土矿", "氧化铝"] },
      { name: "中游：电解铝/加工", keywords: ["电解铝", "铝加工", "铝箔"] },
      { name: "下游：汽车/新能源", keywords: ["汽车零部件", "光伏", "消费电子"] },
    ],
  },
  {
    id: "coal", name: "煤炭产业链",
    nodes: [
      { name: "上游：煤炭开采", keywords: ["煤炭", "焦煤", "动力煤"] },
      { name: "中游：洗选/运输", keywords: ["煤化工", "焦化", "运输"] },
      { name: "下游：电力/钢铁", keywords: ["电力", "钢铁", "水泥"] },
    ],
  },
  {
    id: "securities", name: "证券金融科技产业链",
    nodes: [
      { name: "上游：系统/数据", keywords: ["金融科技", "证券软件", "数据"] },
      { name: "中游：券商/交易", keywords: ["券商", "证券", "财富管理"] },
      { name: "下游：资管/机构", keywords: ["基金", "保险", "银行"] },
    ],
  },
  {
    id: "insurance", name: "保险产业链",
    nodes: [
      { name: "上游：投资/承保", keywords: ["保险", "再保险"] },
      { name: "中游：寿险/财险", keywords: ["寿险", "财险", "健康险"] },
      { name: "下游：医疗/养老", keywords: ["医疗服务", "养老", "资产管理"] },
    ],
  },
  {
    id: "game-media", name: "游戏传媒产业链",
    nodes: [
      { name: "上游：IP/研发", keywords: ["游戏", "影视", "IP"] },
      { name: "中游：发行/平台", keywords: ["游戏发行", "流媒体", "广告"] },
      { name: "下游：渠道/消费", keywords: ["传媒", "互联网", "AI应用"] },
    ],
  },
  {
    id: "education", name: "教育产业链",
    nodes: [
      { name: "上游：内容/系统", keywords: ["教育信息化", "教材", "软件"] },
      { name: "中游：学校/培训", keywords: ["教育", "培训", "职业教育"] },
      { name: "下游：就业/人才", keywords: ["人才", "招聘", "人力资源"] },
    ],
  },
  {
    id: "tourism", name: "旅游消费产业链",
    nodes: [
      { name: "上游：景区/交通", keywords: ["景区", "酒店", "航空"] },
      { name: "中游：旅行社/平台", keywords: ["旅游", "OTA", "免税"] },
      { name: "下游：消费/零售", keywords: ["消费", "零售", "餐饮"] },
    ],
  },
  {
    id: "agricultural", name: "现代农业产业链",
    nodes: [
      { name: "上游：种业/农资", keywords: ["种业", "种子", "化肥", "农药"] },
      { name: "中游：种植/养殖", keywords: ["农业", "种植", "养殖"] },
      { name: "下游：食品/贸易", keywords: ["食品", "粮食", "农产品"] },
    ],
  },
  {
    id: "environmental", name: "环保产业链",
    nodes: [
      { name: "上游：设备/材料", keywords: ["环保设备", "膜", "催化剂"] },
      { name: "中游：工程/运营", keywords: ["环保", "污水处理", "固废"] },
      { name: "下游：再生/资源", keywords: ["再生资源", "碳交易", "节能"] },
    ],
  },
];

function matchScore(node, boardName) {
  const b = String(boardName || "").trim();
  if (!b) return 0;
  let best = 0;
  for (const k of node.keywords || []) {
    if (!k || k.length < 2) continue;
    if (b === k) { best = Math.max(best, 2); continue; }
    if (b.includes(k) || k.includes(b)) best = Math.max(best, 1);
  }
  return best;
}

export function locateChain(boardName) {
  let best = null;
  for (const chain of CHAIN_KB) {
    for (let i = 0; i < chain.nodes.length; i++) {
      const s = matchScore(chain.nodes[i], boardName);
      if (s > 0 && (!best || s > best.score)) best = { chain, nodeIdx: i, score: s };
    }
  }
  return best ? { chain: best.chain, nodeIdx: best.nodeIdx } : null;
}

export function buildChainView(boardName, hops = 2) {
  const hit = locateChain(boardName);
  if (!hit) return null;
  const { chain, nodeIdx } = hit;
  const nodes = chain.nodes.map((n) => n.name);
  const upstream = nodes.slice(Math.max(0, nodeIdx - hops), nodeIdx).reverse();
  const downstream = nodes.slice(nodeIdx + 1, nodeIdx + 1 + hops);
  return {
    chainId: chain.id,
    chainName: chain.name,
    boardName,
    nodeIdx,
    nodeName: chain.nodes[nodeIdx].name,
    nodes,
    upstream,
    downstream,
    atHead: nodeIdx === 0,
    atTail: nodeIdx === chain.nodes.length - 1,
  };
}

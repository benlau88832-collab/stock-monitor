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

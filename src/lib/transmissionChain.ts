// ============================================================
// v9.140.0（阶段三·景气度深化 #14）：传导链多跳视图 —— 产业链上下游知识库
// 定位：景气度投资人看"价格/政策从哪来、往哪传"。给定一个行业板块名，
//   在产业链知识库中定位其节点，输出 上游(供给/原料) → 本节点 → 下游(需求/应用) 的多跳链。
// 纯函数 + 内置知识库（东财行业/概念板块名为节点，关键词双匹配防板块名漂移）；
// 板块名不在库中 → 返回 null（诚实缺省，不硬凑）。
// ============================================================

export interface ChainNode {
  /** 节点名（板块名或环节名，展示用） */
  name: string;
  /** 匹配关键词（板块名 contains 任一词 或 词 contains 板块名） */
  keywords: string[];
}

export interface IndustryChain {
  /** 链标识（英文） */
  id: string;
  /** 链名（中文展示） */
  name: string;
  /** 有序节点：索引 0 = 最上游，末位 = 最下游 */
  nodes: ChainNode[];
}

export interface ChainView {
  chainId: string;
  chainName: string;
  /** 命中的板块名（原输入） */
  boardName: string;
  /** 命中节点在链中的索引 */
  nodeIdx: number;
  /** 命中节点名 */
  nodeName: string;
  /** 有序全链节点名（上游→下游） */
  nodes: string[];
  /** 上游节点（从近到远，hops 跳内） */
  upstream: string[];
  /** 下游节点（从近到远，hops 跳内） */
  downstream: string[];
  /** 是否位于链的最上游/最下游（无上游/下游可传导） */
  atHead: boolean;
  atTail: boolean;
}

// ---------- 产业链知识库（节点=东财行业/概念板块名或环节名） ----------
export const CHAIN_KB: IndustryChain[] = [
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
];

/** 匹配打分：完全相等=2（优先），单向包含=1（词长≥2），不匹配=0 —— 防"电池"误配"电池材料" */
function matchScore(node: ChainNode, boardName: string): number {
  const b = boardName.trim();
  if (!b) return 0;
  let best = 0;
  for (const k of node.keywords) {
    if (!k || k.length < 2) continue;
    if (b === k) { best = Math.max(best, 2); continue; }
    if (b.includes(k) || k.includes(b)) best = Math.max(best, 1);
  }
  return best;
}

/** 在知识库中定位板块名 → 所在链 + 节点索引（取最高匹配分；同分取链序靠前）；未命中返回 null */
export function locateChain(boardName: string): { chain: IndustryChain; nodeIdx: number } | null {
  let best: { chain: IndustryChain; nodeIdx: number; score: number } | null = null;
  for (const chain of CHAIN_KB) {
    for (let i = 0; i < chain.nodes.length; i++) {
      const s = matchScore(chain.nodes[i], boardName);
      if (s > 0 && (!best || s > best.score)) best = { chain, nodeIdx: i, score: s };
    }
  }
  return best ? { chain: best.chain, nodeIdx: best.nodeIdx } : null;
}

/** 构建传导链视图：上游/下游各 hops 跳（默认 2 跳）；未命中返回 null */
export function buildChainView(boardName: string, hops = 2): ChainView | null {
  const hit = locateChain(boardName);
  if (!hit) return null;
  const { chain, nodeIdx } = hit;
  const nodes = chain.nodes.map(n => n.name);
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

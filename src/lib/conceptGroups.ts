// 概念词根合并表（v9.26.15 方案A：纯概念级聚类）
// 用户视角的"涨停原因"大类 ← 东财 datacenter 概念名（词根匹配）
// 与开盘啦/同花顺口径对齐：一只股票的一堆概念（通信/5G/光模块/华为…）折叠成一个用户熟悉的大类
//
// 用法：
//   conceptGroupOf("光模块") → "通信"
//   conceptGroupOf("PCB")    → "元器件"
//   无法折叠 → 原样返回（作为独立题材）

export interface ConceptGroupDef {
  /** 用户视角大类名（作战卡展示） */
  group: string;
  /** 覆盖该大类的词根（概念名 contains 任一即归属） */
  roots: string[];
}

/** 大类词根表（v9.51 V7-4 重构：去单字词根 + 去大类重叠 + 教育独立）
 *  规则：① 词根 ≥2 字（删除 硅/铜/铝/锡/铅/钛/AR/MR 等单/双字易误命中）
 *        ② 重叠概念按主属性唯一归属（算力基建→算力；光通信器件→通信；玻璃→材料）
 *        ③ 教育/在线教育/知识付费 独立"教育"组（不再被 AI应用 吞并）
 *  匹配：conceptGroupOf 采用"最长词根优先 + 同长按本表顺序"（V7-5） */
export const CONCEPT_GROUPS: ConceptGroupDef[] = [
  {
    group: "通信",
    roots: ["通信", "5G", "6G", "光模块", "光通信", "CPO", "卫星通信", "海缆", "光缆", "光纤", "华为", "华为昇腾", "交换机", "物联网", "毫米波"],
  },
  {
    group: "芯片",
    roots: ["芯片", "半导体", "国产芯片", "存储芯片", "封测", "光刻", "EDA", "CPU", "GPU", "DPU", "MCU", "碳化硅", "氮化镓", "晶圆", "先进封装", "chiplet", "硅片"],
  },
  {
    group: "AI应用",
    roots: ["AI应用", "AI智能体", "AI眼镜", "AI手机", "AI PC", "Copilot", "数字人", "智能体", "多模态", "AIGC", "大模型", "人工智能"],
  },
  {
    group: "算力",
    roots: ["算力", "服务器", "液冷", "散热", "铜缆", "高速连接", "数据中心", "IDC", "东数西算", "算力租赁", "边缘计算", "温控"],
  },
  {
    group: "智能驾驶",
    roots: ["智能驾驶", "无人驾驶", "自动驾驶", "激光雷达", "毫米波雷达", "车载", "智能座舱", "车路云", "V2X", "线控", "智驾", "Robotaxi", "高精地图"],
  },
  {
    group: "有色金属",
    roots: ["有色金属", "稀土", "黄金", "白银", "贵金属", "小金属", "稀有金属", "铜矿", "电解铝", "锌业", "钼", "钨", "锑", "锗", "镓", "铟", "镍", "锡矿"],
  },
  {
    group: "元器件",
    roots: ["元件", "PCB", "覆铜板", "铜箔", "连接器", "电容", "电感", "电阻", "继电器", "传感器", "MLCC", "被动元件", "电路板"],
  },
  {
    group: "消费电子",
    roots: ["消费电子", "智能手机", "折叠屏", "AR眼镜", "VR", "MR设备", "XR", "耳机", "TWS", "智能手表", "可穿戴", "摄像头", "苹果", "小米", "光学", "屏下摄像", "快充", "无线充电"],
  },
  {
    group: "军工",
    roots: ["军工", "航天", "卫星", "导航", "航空", "大飞机", "C919", "无人机", "导弹", "军用雷达", "军工电子", "船舶", "海防", "商业航天", "低空经济"],
  },
  {
    group: "新能源车",
    roots: ["新能源车", "电动汽车", "锂电池", "动力电池", "固态电池", "钠电池", "充电桩", "锂电", "氢能源", "燃料电池", "换电"],
  },
  {
    group: "新能源",
    roots: ["光伏", "风电", "储能", "特高压", "电网", "逆变器", "电力设备", "绿电", "硅料", "多晶硅", "单晶硅", "工业硅"],
  },
  {
    group: "机器人",
    roots: ["机器人", "减速器", "执行器", "灵巧手", "伺服", "电机", "丝杠", "滚柱", "谐波", "人形机器人", "机器视觉"],
  },
  {
    group: "半导体设备",
    roots: ["半导体设备", "光刻机", "刻蚀", "薄膜", "清洗", "检测设备", "离子注入"],
  },
  {
    group: "化工",
    roots: ["化工", "化学制品", "化肥", "农药", "化纤", "钛白粉", "磷化工", "有机硅", "氟化工", "煤化工", "染料", "涂料"],
  },
  {
    group: "材料",
    roots: ["塑料", "玻璃", "化学原料", "金属新材料", "新材料"],
  },
  {
    group: "医药",
    roots: ["医药", "创新药", "减肥药", "GLP-1", "CXO", "CRO", "疫苗", "基因", "血液制品", "中药", "医疗器械", "医疗服务"],
  },
  {
    group: "金融",
    roots: ["证券", "券商", "保险", "银行", "金融科技", "数字货币", "跨境支付", "互联网金融"],
  },
  {
    group: "地产链",
    roots: ["房地产", "地产", "物业", "建材", "水泥", "钢铁", "装修", "家居", "家电"],
  },
  {
    group: "大消费",
    roots: ["白酒", "食品", "饮料", "乳业", "调味品", "免税", "零售", "电商", "直播", "网红", "旅游", "酒店", "餐饮", "预制菜"],
  },
  {
    group: "传媒",
    roots: ["传媒", "影视", "游戏", "动漫", "短剧", "MCN", "广告", "出版", "文化"],
  },
  // v9.51（V7-4）：教育独立成组（不再被 AI应用 吞并）
  {
    group: "教育",
    roots: ["教育", "职业教育", "培训", "在线教育", "知识付费", "K12", "高校", "教辅"],
  },
];

/** 概念名 → 用户大类（V7-5：最长词根优先，同长按表序；无匹配返回 null） */
export function conceptGroupOf(conceptName: string): string | null {
  if (!conceptName) return null;
  let best: { group: string; len: number } | null = null;
  for (const def of CONCEPT_GROUPS) {
    for (const root of def.roots) {
      if (root.length < 2) continue; // V7-4：拒绝单字词根（防 硅/铜/铝 误命中）
      if (conceptName.includes(root)) {
        // 最长词根优先（"激光雷达"5字 > "雷达"2字 → 智能驾驶）；
        // 同长时靠本表顺序（前面的优先，故具体组尽量靠前定义）
        if (!best || root.length > best.len) {
          best = { group: def.group, len: root.length };
        }
      }
    }
  }
  return best?.group ?? null;
}

/** 把一批概念名折叠成用户大类集合（含无法折叠的原名） */
export function foldConcepts(concepts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of concepts) {
    const g = conceptGroupOf(c) ?? c;
    if (!seen.has(g)) { seen.add(g); out.push(g); }
  }
  return out;
}

// ============== 板块资金流聚合（v9.26.16） ==============
// 把 boards 列表（"人工智能"/"AI眼镜" 等原始名）折叠成用户大类（"AI应用"等）并聚合资金
// 解决：主线名是用户大类（"AI应用"），但 boards 原始名是细分概念（"人工智能"），模糊匹配对不上 → 资金 0
export interface BoardFund {
  name: string;
  pct: number;
  mainNet: number;
  mainNet5d?: number;
  mainNet5dPct?: number;
}

/** 把 boards 按用户大类折叠聚合资金（同大类的所有细分概念资金累加） */
export function foldBoardFunds(boards: BoardFund[]): Map<string, BoardFund> {
  const map = new Map<string, BoardFund>();
  for (const b of boards) {
    const g = conceptGroupOf(b.name) ?? b.name;
    const prev = map.get(g);
    if (prev) {
      prev.mainNet += b.mainNet;
      prev.mainNet5d = (prev.mainNet5d ?? 0) + (b.mainNet5d ?? 0);
      prev.mainNet5dPct = ((prev.mainNet5dPct ?? 0) + (b.mainNet5dPct ?? 0)) / 2; // 简单平均
      // pct 取加权（mainNet 绝对值大的板块更代表该大类）
      const totalAbs = Math.abs(prev.mainNet) + Math.abs(b.mainNet);
      prev.pct = totalAbs > 0
        ? (prev.pct * Math.abs(prev.mainNet) + b.pct * Math.abs(b.mainNet)) / totalAbs
        : prev.pct;
    } else {
      map.set(g, { name: g, pct: b.pct, mainNet: b.mainNet, mainNet5d: b.mainNet5d, mainNet5dPct: b.mainNet5dPct });
    }
  }
  return map;
}

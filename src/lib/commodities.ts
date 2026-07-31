// 产业链价格监控品种表（可编辑：新增品种只需追加一项）
// secidCandidates：候选东财 secid，运行时逐个探测取第一个有数据的
// chain：产业链传导逻辑一句话
// relatedBoards：相关概念板块名（用于匹配现有板块资金流数据）

export interface CommoditySpec {
  name: string;
  secidCandidates: string[];
  chain: string;
  relatedBoards: string[];
}

// 品种列表
// secid 格式说明：
//   115.xxx = 上期所/上期能源  113.xxx = 大商所  114.xxx = 郑商所
//   101.xxx = CME/COMEX/NYMEX  103.xxx = ICE
// 主连合约通常以 "m" 结尾（如 LCm = 碳酸锂主连）
export const COMMODITY_LIST: CommoditySpec[] = [
  {
    name: "碳酸锂",
    // 广期所碳酸锂 LCm / 备选尝试大商所格式
    secidCandidates: ["142.LCm", "115.LCm", "113.LCm", "114.LCm"],
    chain: "碳酸锂↗正极材料↗电池成本→锂电/新能源车整车利润空间",
    relatedBoards: ["锂电池", "新能源", "新能源车"],
  },
  {
    name: "工业硅",
    secidCandidates: ["142.SIm", "115.SIm", "114.SIm"],
    chain: "工业硅↗多晶硅→光伏组件成本↗分布式光伏装机意愿",
    relatedBoards: ["光伏", "多晶硅", "新能源"],
  },
  {
    name: "生猪",
    secidCandidates: ["113.LHm", "114.LHm"],
    chain: "猪价↗CPI食品项→养殖利润→产能扩缩周期",
    relatedBoards: ["猪肉", "养殖业", "农业"],
  },
  {
    name: "螺纹钢",
    secidCandidates: ["115.RBm", "113.RBm"],
    chain: "螺纹价↗建筑用钢需求→地产基建开工景气度",
    relatedBoards: ["钢铁", "基建", "房地产"],
  },
  {
    name: "沪铜",
    secidCandidates: ["115.CUm", "113.CUm"],
    chain: "铜价=宏观经济晴雨表→电网/新能源/家电铜消费",
    relatedBoards: ["有色金属", "铜", "电力"],
  },
  {
    name: "原油",
    // 上期能源 SC / NYMEX CL
    secidCandidates: ["115.SCm", "101.CL00Y"],
    chain: "油价↗化工链成本→石化/化工/航空/航运利润分化",
    relatedBoards: ["石油", "化工", "航运"],
  },
  {
    name: "黄金",
    secidCandidates: ["115.AUm", "101.GC00Y"],
    chain: "金价↗避险情绪+实际利率下行→贵金属/黄金珠宝",
    relatedBoards: ["黄金", "贵金属"],
  },
  {
    name: "白银",
    secidCandidates: ["115.AGm", "101.SI00Y"],
    chain: "银价兼具贵金属+工业属性→光伏银浆/电子焊料",
    relatedBoards: ["白银", "贵金属", "光伏"],
  },
];

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

// 品种列表（v9.95.4 第五段 P1：8 → 41 品种全品种扩展；secid 探测失败自动跳过，不影响其余）
// secid 格式说明：
//   115.xxx = 上期所/上期能源  113.xxx = 大商所  114.xxx = 郑商所  142.xxx = 广期所
//   101.xxx = CME/COMEX/NYMEX  103.xxx = ICE/CBOT
// 主连合约通常以 "m" 结尾（如 LCm = 碳酸锂主连）；国际品种用 00Y 连续格式
export const COMMODITY_LIST: CommoditySpec[] = [
  // ---- 有色金属（基本金属 + 贵金属）----
  { name: "沪铜", secidCandidates: ["115.CUm", "113.CUm"], chain: "铜价=宏观经济晴雨表→电网/新能源/家电铜消费", relatedBoards: ["有色金属", "铜", "电力"] },
  { name: "沪铝", secidCandidates: ["115.ALm", "113.ALm"], chain: "铝价↗电解铝利润→新能源车轻量化/光伏边框需求", relatedBoards: ["有色金属", "铝", "新能源"] },
  { name: "沪锌", secidCandidates: ["115.ZNm", "113.ZNm"], chain: "锌价↗镀锌钢需求→基建/地产竣工链", relatedBoards: ["有色金属", "锌"] },
  { name: "沪铅", secidCandidates: ["115.PBm", "113.PBm"], chain: "铅价↗铅酸电池→电动两轮车/储能需求", relatedBoards: ["有色金属", "铅", "电池"] },
  { name: "沪镍", secidCandidates: ["115.NIm", "113.NIm"], chain: "镍价↗三元电池/不锈钢成本→新能源车与特钢", relatedBoards: ["有色金属", "镍", "锂电池"] },
  { name: "沪锡", secidCandidates: ["115.SNm", "113.SNm"], chain: "锡价↗半导体焊料→电子产业链景气", relatedBoards: ["有色金属", "锡", "半导体"] },
  { name: "国际铜", secidCandidates: ["115.BCm", "115.CUm"], chain: "国际铜=保税区铜价→内外价差与进口套利", relatedBoards: ["有色金属", "铜"] },
  { name: "黄金", secidCandidates: ["115.AUm", "101.GC00Y"], chain: "金价↗避险情绪+实际利率下行→贵金属/黄金珠宝", relatedBoards: ["黄金", "贵金属"] },
  { name: "白银", secidCandidates: ["115.AGm", "101.SI00Y"], chain: "银价兼具贵金属+工业属性→光伏银浆/电子焊料", relatedBoards: ["白银", "贵金属", "光伏"] },
  // ---- 黑色系 ----
  { name: "螺纹钢", secidCandidates: ["115.RBm", "113.RBm"], chain: "螺纹价↗建筑用钢需求→地产基建开工景气度", relatedBoards: ["钢铁", "基建", "房地产"] },
  { name: "热卷", secidCandidates: ["115.HCm", "113.HCm"], chain: "热卷↗制造业用钢→汽车/家电/机械出口链", relatedBoards: ["钢铁", "制造业"] },
  { name: "铁矿石", secidCandidates: ["113.Im", "115.Im"], chain: "铁矿↗钢厂成本→钢价传导与利润压缩", relatedBoards: ["钢铁", "铁矿石"] },
  { name: "焦炭", secidCandidates: ["113.Jm", "115.Jm"], chain: "焦炭↗焦煤成本+钢厂需求→黑色链利润分配", relatedBoards: ["煤炭", "钢铁"] },
  { name: "焦煤", secidCandidates: ["113.JMm", "114.JMm"], chain: "焦煤↗焦化成本→双焦联动", relatedBoards: ["煤炭"] },
  { name: "不锈钢", secidCandidates: ["115.SSm", "113.SSm"], chain: "不锈钢↗镍价+特钢需求→家电/厨具/化工设备", relatedBoards: ["钢铁", "镍"] },
  // ---- 能源化工 ----
  { name: "原油", secidCandidates: ["115.SCm", "101.CL00Y"], chain: "油价↗化工链成本→石化/化工/航空/航运利润分化", relatedBoards: ["石油", "化工", "航运"] },
  { name: "燃油", secidCandidates: ["115.FUm", "101.CL00Y"], chain: "燃油↗船用燃料→航运成本", relatedBoards: ["石油", "航运"] },
  { name: "沥青", secidCandidates: ["115.BUm", "113.BUm"], chain: "沥青↗道路建设需求→基建开工", relatedBoards: ["基建", "石油"] },
  { name: "LPG", secidCandidates: ["113.PGm", "115.PGm"], chain: "LPG↗民用燃料+化工原料→燃气/PDH化工", relatedBoards: ["燃气", "化工"] },
  { name: "橡胶", secidCandidates: ["115.RUm", "113.RUm"], chain: "橡胶↗轮胎成本→汽车/重卡需求", relatedBoards: ["橡胶", "轮胎", "汽车"] },
  { name: "PTA", secidCandidates: ["114.TAm", "115.TAm"], chain: "PTA↗聚酯链→纺织服装成本", relatedBoards: ["化工", "纺织"] },
  { name: "甲醇", secidCandidates: ["114.MAm", "115.MAm"], chain: "甲醇↗煤化工+烯烃→化工链成本", relatedBoards: ["化工", "煤化工"] },
  { name: "纯碱", secidCandidates: ["114.SAm", "113.SAm"], chain: "纯碱↗玻璃/光伏玻璃→地产与光伏装机", relatedBoards: ["化工", "光伏", "玻璃"] },
  { name: "玻璃", secidCandidates: ["114.FGm", "113.FGm"], chain: "玻璃↗地产竣工→浮法玻璃需求", relatedBoards: ["玻璃", "房地产"] },
  { name: "尿素", secidCandidates: ["114.URm", "113.URm"], chain: "尿素↗农资成本→化肥/农业种植", relatedBoards: ["化肥", "农业"] },
  { name: "PVC", secidCandidates: ["113.Vm", "114.Vm"], chain: "PVC↗管材型材→地产链需求", relatedBoards: ["化工", "房地产"] },
  { name: "塑料(PP)", secidCandidates: ["113.PPm", "114.PPm"], chain: "PP↗包装/汽车塑料→消费与制造业", relatedBoards: ["化工", "塑料"] },
  // ---- 农产品 ----
  { name: "玉米", secidCandidates: ["113.Cm", "114.Cm"], chain: "玉米↗饲料成本→养殖利润", relatedBoards: ["农业", "养殖业"] },
  { name: "豆粕", secidCandidates: ["113.Mm", "114.Mm"], chain: "豆粕↗饲料蛋白→养殖成本", relatedBoards: ["农业", "养殖业", "饲料"] },
  { name: "豆油", secidCandidates: ["113.Ym", "114.Ym"], chain: "豆油↗食用油+生物柴油→油脂链", relatedBoards: ["农业", "食用油"] },
  { name: "棕榈油", secidCandidates: ["113.Pm", "114.Pm"], chain: "棕榈油↗全球油脂定价→食品与日化", relatedBoards: ["农业", "食用油"] },
  { name: "菜油", secidCandidates: ["114.OIm", "113.OIm"], chain: "菜油↗国产油脂→油料种植", relatedBoards: ["农业", "食用油"] },
  { name: "白糖", secidCandidates: ["114.SRm", "101.SB00Y"], chain: "糖价↗食品饮料成本→糖业利润", relatedBoards: ["农业", "食品饮料", "糖"] },
  { name: "棉花", secidCandidates: ["114.CFm", "103.CT00Y"], chain: "棉价↗纺织成本→服装出口链", relatedBoards: ["农业", "纺织"] },
  { name: "鸡蛋", secidCandidates: ["113.JDm", "114.JDm"], chain: "蛋价↗CPI食品项→养殖周期", relatedBoards: ["农业", "养殖业"] },
  { name: "苹果", secidCandidates: ["114.APm", "113.APm"], chain: "苹果↗生鲜消费→果蔬价格", relatedBoards: ["农业"] },
  { name: "生猪", secidCandidates: ["113.LHm", "114.LHm"], chain: "猪价↗CPI食品项→养殖利润→产能扩缩周期", relatedBoards: ["猪肉", "养殖业", "农业"] },
  { name: "花生", secidCandidates: ["114.PKm", "113.PKm"], chain: "花生↗油脂+食品→油料作物", relatedBoards: ["农业", "食用油"] },
  // ---- 新能源 ----
  { name: "碳酸锂", secidCandidates: ["142.LCm", "115.LCm", "113.LCm", "114.LCm"], chain: "碳酸锂↗正极材料↗电池成本→锂电/新能源车整车利润空间", relatedBoards: ["锂电池", "新能源", "新能源车"] },
  { name: "工业硅", secidCandidates: ["142.SIm", "115.SIm", "114.SIm"], chain: "工业硅↗多晶硅→光伏组件成本↗分布式光伏装机意愿", relatedBoards: ["光伏", "多晶硅", "新能源"] },
  { name: "多晶硅", secidCandidates: ["142.PSm", "115.PSm"], chain: "多晶硅↗光伏组件成本→硅料环节利润", relatedBoards: ["光伏", "多晶硅"] },
];

// ============== v9.95.4（第五段 P1）：小金属监测（无期货合约，新闻/概念监测） ==============
// 钨/磷化铟等小金属无东财期货主连 → 用快讯关键词监测（newsByKeyword 本地 PG 优先）
export interface SmallMetalSpec {
  name: string;
  keywords: string[];
  chain: string;
}
export const SMALL_METALS: SmallMetalSpec[] = [
  { name: "钨", keywords: ["钨", "硬质合金", "钨矿"], chain: "钨→硬质合金/切削刀具→高端制造（无期货，监测快讯）" },
  { name: "磷化铟", keywords: ["磷化铟", "InP"], chain: "磷化铟→光通信/激光器衬底→AI 算力链（无期货，监测快讯）" },
  { name: "锑", keywords: ["锑", "锑价"], chain: "锑→阻燃剂/光伏玻璃澄清剂→小金属涨价（无期货，监测快讯）" },
  { name: "钼", keywords: ["钼", "钼价"], chain: "钼→特种钢/军工合金（无期货，监测快讯）" },
];

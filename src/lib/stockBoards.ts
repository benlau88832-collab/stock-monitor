// 个股所属概念（v9.21-B）
// 数据源：东财 datacenter RPT_F10_CORETHEME_BOARDTYPE
// 返回每只股票的"所属板块"列表（含题材概念 + 指数成分 + 地域板块 等）
// 用途：取代"拉概念成分股反查"——每只涨停股直接知道它属于哪些概念（同花顺式）
// 纯数据层

// ============== 非题材分类过滤词表（保留"机器人/减速器/AI应用"等真实题材） ==============
const NON_THEME_PATTERNS = [
  // 指数/成分类
  /沪深300|上证50|中证500|中证1000|创业板指|深证|上证180|深证100|科创50|国证|中证|MSCI|富时|标普|罗素|央视50|融资融券|转融券|深股通|沪股通|AH|AB股|CDR|H股|B股|QFII|证金|汇金|社保|保险重仓|基金重仓|券商重仓|信托重仓/,
  // 地域/板块类
  /板块$|概念$|新股|次新股|昨日涨停|昨日连板|昨日首板|最近多板|最近强势|最近异动|活跃股|热门股|热股|强势股|预盈预增|预亏预减|高送转|送转|填权|破净|低价股|高价股|百元股|微盘|小盘股|大盘股|中盘股|新三板|退市|ST板块/,
  // 维度类
  /东方财富|同花顺|标准|成分|权重|样本/,
];

/** 判断板块名是否为"真实题材概念"（排除指数成分/地域/涨跌状态类） */
export function isThemeBoard(name: string): boolean {
  if (!name || name.length === 0) return false;
  // 必须有题材含义：包含"概念"关键词或属于已知题材词根
  const themeHints = /机器人|AI|人工智能|算力|芯片|半导体|光模块|CPO|信创|软件|数据|云|算力|游戏|传媒|新能源|光伏|储能|电池|锂|汽车|华为|苹果|小米|稀土|钴|锂|氢|军工|航天|卫星|导航|船舶|核电|电力|电网|特高压|风电|充电|光伏|机器人|减速器|轴承|汽车零部件|减速|传感器|激光|元宇宙|数字经济|东数西算|5G|6G|通信|量子|脑机|低空|飞行|商业航天|智能驾驶|无人驾驶|汽车电子|消费电子|面板|存储|封测|光刻|光刻机|中芯|CPU|GPU|DPU|交换机|服务器|液冷|PCB|覆铜板|军工电子|航天电子|航空发动机|大飞机|C919|船|海洋|水声|机器人执行器|灵巧手|电机|电控|丝杠|滚柱|谐波/;
  return themeHints.test(name) || (!NON_THEME_PATTERNS.some(p => p.test(name)) && name.length <= 8);
}

// ============== 数据结构 ==============
export interface StockBoards {
  code: string;
  /** 该股所属的全部题材概念名（已过滤非题材） */
  themes: string[];
  /** 全部板块（未过滤，调试用） */
  allBoards: string[];
}

// ============== 批量查询 ==============
const DATACENTER = "https://datacenter-web.eastmoney.com/api/data/v1/get";

/**
 * 批量查询多只股票的所属概念（一次 IN 查询，最多 30 只）
 * @param codes 股票代码（如 ["002896","002230"]）
 */
export async function fetchStocksBoards(codes: string[]): Promise<Map<string, StockBoards>> {
  const result = new Map<string, StockBoards>();
  if (codes.length === 0) return result;

  // 分块：每批 30 只
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += 30) chunks.push(codes.slice(i, i + 30));

  for (const chunk of chunks) {
    const codeList = chunk.map(c => `"${c}"`).join(",");
    const url = `${DATACENTER}?reportName=RPT_F10_CORETHEME_BOARDTYPE&columns=ALL&filter=(SECURITY_CODE%20in%20(${encodeURIComponent(codeList).replace(/%22/g, '"')}))&pageSize=500&source=HSF10&client=WEB`;
    try {
      const resp = await fetch(url, { headers: { Referer: "https://emweb.securities.eastmoney.com/" } });
      const json = await resp.json();
      const data: any[] = json?.result?.data ?? [];
      // 按 code 聚合
      const byCode = new Map<string, string[]>();
      for (const item of data) {
        const code = String(item.SECURITY_CODE ?? "");
        const board = String(item.BOARD_NAME ?? "");
        if (!code || !board) continue;
        if (!byCode.has(code)) byCode.set(code, []);
        byCode.get(code)!.push(board);
      }
      for (const code of chunk) {
        const allBoards = byCode.get(code) ?? [];
        const themes = allBoards.filter(isThemeBoard);
        result.set(code, { code, themes, allBoards });
      }
    } catch (e) {
      console.warn(`[fetchStocksBoards] 查询失败 chunk=${chunk.length}只:`, e);
    }
  }
  return result;
}

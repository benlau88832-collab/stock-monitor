// ============================================================
// src/lib/emFields.ts —— 东财行情 f 字段常量（P1-16 试点收敛）
// 背景：同一字段映射（f2→price/f3→pct/f12→code/f14→name/f62→mainNet 等）
//   在 api.ts 5+ 处内联重复 —— 东财改字段时要改多处且易漏。
// 本表为唯一权威：新代码一律引用常量；存量调用点随改造逐步迁移。
// ============================================================

export const EM_F = {
  /** 基础行情 */
  PRICE: "f2",
  PCT: "f3",
  CHANGE: "f4",
  VOLUME: "f5",
  AMOUNT: "f6",
  AMPLITUDE: "f7",
  TURNOVER: "f8",
  PE: "f9",
  VOL_RATIO: "f10",
  HIGH: "f15",
  LOW: "f16",
  OPEN: "f17",
  PRE_CLOSE: "f18",
  /** 代码/名称 */
  CODE: "f12",
  NAME: "f14",
  /** 主力资金（元/占比/多日） */
  MAIN_NET: "f62",
  EXTRA_LARGE_NET: "f66",
  LARGE_NET: "f72",
  MEDIUM_NET: "f78",
  SMALL_NET: "f84",
  MAIN_NET_5D: "f164",
  MAIN_NET_5D_PCT: "f165",
  MAIN_NET_10D: "f174",
  MAIN_NET_10D_PCT: "f175",
  MAIN_NET_PCT: "f184",
  /** 涨跌停/统计 */
  LIMIT_UP_COUNT: "f104",
  LIMIT_DOWN_COUNT: "f105",
  ZT_PRICE: "f119",
  ZT_PCT: "f120",
} as const;

/** 常用字段串（ulist/clist 请求 fields 参数用） */
export const EM_FIELDS_BASIC = `${EM_F.PRICE},${EM_F.PCT},${EM_F.CHANGE},${EM_F.CODE},${EM_F.NAME}`;
export const EM_FIELDS_QUOTE = `${EM_F.PRICE},${EM_F.PCT},${EM_F.CHANGE},${EM_F.CODE},${EM_F.NAME},${EM_F.VOLUME},${EM_F.AMOUNT},${EM_F.HIGH},${EM_F.LOW},${EM_F.OPEN},${EM_F.PRE_CLOSE},${EM_F.TURNOVER},${EM_F.VOL_RATIO}`;
export const EM_FIELDS_FUND = `${EM_F.CODE},${EM_F.NAME},${EM_F.PRICE},${EM_F.PCT},${EM_F.MAIN_NET},${EM_F.MAIN_NET_PCT},${EM_F.MAIN_NET_5D},${EM_F.MAIN_NET_10D}`;

import {
  pgTable,
  serial,
  varchar,
  numeric,
  date,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// 自选股 / 监控列表
export const watchlist = pgTable(
  "watchlist",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 12 }).notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeIdx: uniqueIndex("watchlist_code_idx").on(t.code),
  }),
);

// 资金结构历史快照：每次真实抓取数据时落库一条记录，
// 用于计算「近 N 日资金结构连续性」等大局观指标。
// scope: 'market' | 'sector' | 'stock'
export const fundFlowSnapshots = pgTable(
  "fund_flow_snapshots",
  {
    id: serial("id").primaryKey(),
    scope: varchar("scope", { length: 16 }).notNull(),
    code: varchar("code", { length: 20 }).notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    tradeDate: date("trade_date").notNull(),
    pctChange: numeric("pct_change", { precision: 10, scale: 3 }),
    mainNet: numeric("main_net", { precision: 20, scale: 2 }),
    mainNet5d: numeric("main_net_5d", { precision: 20, scale: 2 }),
    mainNet10d: numeric("main_net_10d", { precision: 20, scale: 2 }),
    extraLargeNet: numeric("extra_large_net", { precision: 20, scale: 2 }),
    largeNet: numeric("large_net", { precision: 20, scale: 2 }),
    mediumNet: numeric("medium_net", { precision: 20, scale: 2 }),
    smallNet: numeric("small_net", { precision: 20, scale: 2 }),
    northNet: numeric("north_net", { precision: 20, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqScopeCodeDate: uniqueIndex("ffs_scope_code_date_idx").on(t.scope, t.code, t.tradeDate),
    scopeIdx: index("ffs_scope_idx").on(t.scope, t.code),
  }),
);

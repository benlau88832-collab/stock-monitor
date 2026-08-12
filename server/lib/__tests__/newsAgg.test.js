// ============================================================
// v9.124.0（蓝图 4A T-资讯-1/2）：newsAgg 资讯聚合纯函数单测 ——
//   多源 normalize 形状 / mapNewsToEntities 概念打标（真实词表）/ upsert 去重幂等。
// 抓取函数（fetchStockNewsServer）涉外部网络，单测不触发（依赖注入面留给运行时实测）。
// ============================================================
import { describe, it, expect } from "vitest";
import { normalizeEmwebArticle, normalizeSearchArticle, normalizeKuaixun, mapNewsToEntities, upsertNewsFeed } from "../newsAgg";

describe("v9.124.0 newsAgg normalize（蓝图 4A T-资讯-1）", () => {
  it("normalizeEmwebArticle：NOTICE_TITLE/Url/NOTICE_DATE 形状（emweb F10）", () => {
    const it = normalizeEmwebArticle({ NOTICE_TITLE: "贵州茅台：关于2025年年度利润分配方案的公告", CONTENT: "每股派发现金红利……", Url: "https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1", NOTICE_DATE: "2026-08-13 16:20:00" }, "600519");
    expect(it.code).toBe("600519");
    expect(it.source).toBe("emweb");
    expect(it.title).toContain("贵州茅台");
    expect(it.time).toBe("2026-08-13 16:20:00"); // 日期带横杠
  });

  it("normalizeSearchArticle：cmsArticleWebOld 形状 + <em> 标签剥除", () => {
    const it = normalizeSearchArticle({ code: "600519", title: "贵州<em>茅台</em>再创佳绩", summary: "营收……", url: "https://finance.eastmoney.com/a/1.html", date: "2026-08-13 10:00:00" }, "600519");
    expect(it.title).toBe("贵州茅台再创佳绩");
    expect(it.source).toBe("search-api");
  });

  it("normalizeKuaixun：ctime 秒级时间戳 → 带横杠 datetime", () => {
    const it = normalizeKuaixun({ title: "央行开展MLF操作", content: "央行今日开展……", ctime: 1786550000 });
    expect(it.type).toBe("kuaixun");
    expect(it.time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe("v9.124.0 mapNewsToEntities（蓝图 4A T-资讯-2 核心纯函数）", () => {
  it("真实词表命中：'半导体设备国产化' → 命中半导体相关组", () => {
    // 用真实共享词表（server 与 themeAnalysis 同源 require）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CONCEPT_GROUPS } = require("../../../src/shared/concept-groups.js");
    const hits = mapNewsToEntities("半导体设备国产化提速，光刻胶订单放量", CONCEPT_GROUPS);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.join("")).toMatch(/半导体|芯片|光刻/);
  });

  it("词根 <2 字不参与匹配；空文本返回 []", () => {
    const groups = [{ name: "短词", roots: ["A", "光刻机"] }];
    expect(mapNewsToEntities("A股走强", groups)).toEqual([]); // "A" 单字不命中
    expect(mapNewsToEntities("光刻机订单落地", groups)).toContain("短词");
    expect(mapNewsToEntities("", groups)).toEqual([]);
  });

  it("命中上限 3 个", () => {
    const groups = [
      { name: "半导体", roots: ["半导体"] },
      { name: "AI算力", roots: ["算力"] },
      { name: "机器人", roots: ["机器人"] },
      { name: "低空经济", roots: ["低空"] },
    ];
    const hits = mapNewsToEntities("半导体+算力+机器人+低空全线爆发", groups);
    expect(hits).toHaveLength(3);
  });
});

describe("v9.124.0 upsertNewsFeed（幂等去重）", () => {
  it("同 source+title+time 第二次跳过（WHERE NOT EXISTS；rowCount=0）", async () => {
    const calls = [];
    let n = 0;
    const pool = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        n += 1;
        return { rowCount: n === 1 ? 1 : 0 }; // 首条插入，重复条 0 行
      },
    };
    const items = [
      { type: "stock_news", source: "emweb", code: "600519", title: "公告A", time: "2026-08-13 16:20:00" },
      { type: "stock_news", source: "emweb", code: "600519", title: "公告B", time: "2026-08-13 16:21:00" },
    ];
    const added = await upsertNewsFeed(pool, items);
    expect(added).toBe(1); // 第二条被去重跳过（mock 模拟重复）
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain("WHERE NOT EXISTS"); // 幂等 SQL
    expect(JSON.parse(calls[0].params[7])).toBeInstanceOf(Array); // entities JSONB
  });

  it("空 items / 缺 title 直接跳过", async () => {
    let called = 0;
    const pool = { query: async () => { called += 1; return { rowCount: 1 }; } };
    expect(await upsertNewsFeed(pool, [])).toBe(0);
    expect(await upsertNewsFeed(pool, [{ code: "600519", time: "x" }])).toBe(0);
    expect(called).toBe(0);
  });
});

// v9.91.0（概念地基）+ v9.91.3（数据源统一）：概念白名单解析测试
// v9.91.3：数据源从同花顺（GBK 页面）切换为东财 clist 接口（JSON 分页全量 504）
// fixture：真实东财返回结构 {data:{total, diff:[{f12,f14}]}}
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
// @ts-ignore 服务端 CJS 无类型声明
import { fetchConceptList, CLIST_URL } from "../../../server/lib/thsConcepts.js";

describe("conceptWhitelist 东财概念列表解析（v9.91.3）", () => {
  it("CLIST_URL 指向东财 clist 接口（fs=m:90+t:3 概念板块全量）", () => {
    expect(CLIST_URL).toContain("push2delay.eastmoney.com");
    expect(CLIST_URL).toContain("m:90+t:3");
  });

  it("fixture 数据可被东财 diff 结构解析（8 个概念含 BK 代码）", () => {
    const fixture = JSON.parse(
      fs.readFileSync(path.join(__dirname, "fixtures", "em_clist_gn.json"), "utf8"),
    );
    const rows = fixture.data.diff as Array<{ f12: string; f14: string }>;
    expect(rows.length).toBe(8);
    const byCode = new Map(rows.map(r => [r.f12, r.f14]));
    expect(byCode.get("BK0706")).toBe("人脑工程");
    expect(byCode.get("BK1753")).toBe("光刻胶");
    // f12 即 BK 板块代码（与 F10 NEW_BOARD_CODE 互通）
    expect(byCode.get("BK0001")).toBe("储能概念");
  });

  it("白名单名与 F10 BOARD_NAME 同源（去'概念'后缀规范化后互通）", () => {
    // 东财概念板块名（clist f14）与个股 F10 BOARD_NAME 同体系：
    // "光刻胶"（clist）↔ "光刻胶概念"（F10）经 normalize 后一致
    const { normalizeConceptName } = require("../../shared/conceptFilter.js");
    expect(normalizeConceptName("光刻胶")).toBe(normalizeConceptName("光刻胶概念"));
  });
});

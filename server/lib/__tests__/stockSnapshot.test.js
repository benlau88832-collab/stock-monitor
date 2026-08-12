// ============================================================
// v9.123.0（卓越审查 P0-1）：stockSnapshot 解析纯函数单测——
//   锁定两个实测教训：① push2delay stock/get 双层 data.data 嵌套；
//   ② ulist.np 字段错位（ut 混用）已弃用 → 主源为 stock/get。
// ============================================================
import { describe, it, expect } from "vitest";
import { parseStockGet, parseTencentText, toSecid } from "../stockSnapshot";

describe("v9.123.0 stockSnapshot 解析纯函数（P0-1）", () => {
  it("parseStockGet：双层 data.data 嵌套正确解析（实测响应形状）", () => {
    const json = { data: { rc: 0, rt: 4, data: { f43: 1343, f57: "600519", f58: "贵州茅台", f170: -0.26, f168: 0.28 } } };
    const s = parseStockGet(json);
    expect(s.code).toBe("600519");
    expect(s.name).toBe("贵州茅台");
    expect(s.price).toBe(1343);
    expect(s.pct).toBe(-0.26);
    expect(s.turnoverRate).toBe(0.28);
    expect(s.mainNet).toBeNull(); // stock/get 无可靠个股主力净额 → 诚实 null
  });

  it("parseTencentText：GBK Buffer 解码（真实响应形状 v_xx=\"1~…~…\";，ASCII 字段可解析）", () => {
    const fields = new Array(40).fill("0");
    fields[1] = "测试股"; // 中文名（真实 GBK 字节由 TextDecoder 解码；此处 latin1 假字节只验证解析链路不崩）
    fields[2] = "600519";
    fields[3] = "1343.00";
    fields[32] = "-0.26";
    fields[38] = "0.28";
    const body = Buffer.from('v_sh600519="' + fields.join("~") + '";', "latin1");
    const s = parseTencentText(body, "600519");
    expect(s).not.toBeNull();
    expect(s.code).toBe("600519");
    expect(s.price).toBe(1343);
    expect(s.pct).toBe(-0.26);
    expect(s.turnoverRate).toBe(0.28);
  });

  it("parseStockGet：空响应/无 f43 → null（调用方降级 {code}）", () => {
    expect(parseStockGet({ data: { rc: 1 } })).toBeNull();
    expect(parseStockGet(null)).toBeNull();
  });

  it("toSecid：沪市 1. / 深市 0.", () => {
    expect(toSecid("600519")).toBe("1.600519");
    expect(toSecid("000001")).toBe("0.000001");
  });
});

// v9.98.0（批次 3）：基本面体检 —— 阈值表 + 银行专项分流 + 合理价 + 空窗回退（investool 移植）
import { describe, it, expect } from "vitest";
// @ts-ignore 服务端 CJS
import { checkFundamentals, computeRightPrice, isBank, DEFAULT_OPTIONS } from "../../../server/lib/fundamentalChecker.js";

function mockF(overrides: Record<string, unknown> = {}) {
  const latest = {
    REPORT_DATE: "2026-03-31 00:00:00",
    ROEJQ: 12.5, ZCFZL: 45.2, EPSJB: 0.8, TOTALOPERATEREVETZ: 15.3,
    PARENTNETPROFITTZ: 20.1, XSMLL: 30.5, MGJYXJJE: 1.2, NEWCAPITALADER: null,
    SECURITY_NAME_ABBR: "测试股份", SECURITY_CODE: "600000",
    ...overrides,
  };
  return {
    latest,
    annual: { ...latest, REPORT_DATE: "2025-12-31 00:00:00", EPSJB: 0.72, TOTALOPERATEREVETZ: 12.0 },
    valuation: { PE_TTM: 15.0, TOTAL_MARKET_CAP: 200e8, CLOSE_PRICE: 12.0 },
    name: latest.SECURITY_NAME_ABBR,
  };
}

describe("v9.98.0 isBank 银行识别", () => {
  it("名称含银行 → true", () => {
    expect(isBank("浦发银行")).toBe(true);
    expect(isBank("招商银行股份有限公司")).toBe(true);
    expect(isBank("百花医药")).toBe(false);
  });
});

describe("v9.98.0 checkFundamentals 阈值检查", () => {
  it("优质股全过（ROE/负债/EPS/成长/PEG/市值/现金流）", () => {
    const r = checkFundamentals(mockF());
    const byName = Object.fromEntries(r.checks.map((c: { name: string; ok: boolean }) => [c.name, c.ok]));
    expect(byName["净资产收益率(ROE)"]).toBe(true);
    expect(byName["资产负债率"]).toBe(true);
    expect(byName["每股收益(EPS)"]).toBe(true);
    expect(byName["营收成长"]).toBe(true);
    expect(byName["总市值"]).toBe(true);
    expect(byName["每股经营现金流"]).toBe(true);
  });
  it("ROE 低 + 市值小 → 不通过", () => {
    const r = checkFundamentals(mockF({ ROEJQ: 3.2 }));
    const roe = r.checks.find((c: { name: string }) => c.name.includes("ROE"));
    expect(roe?.ok).toBe(false);
    const r2 = checkFundamentals(mockF({}), { minTotalMarketCap: 500e8 });
    const cap = r2.checks.find((c: { name: string }) => c.name.includes("市值"));
    expect(cap?.ok).toBe(false);
  });
  it("银行股：ROE/负债豁免 + 资本充足率专项", () => {
    const r = checkFundamentals(mockF({ SECURITY_NAME_ABBR: "浦发银行", ROEJQ: 2.3, ZCFZL: 91.8, NEWCAPITALADER: 12.48 }));
    expect(r.bank).toBe(true);
    const roe = r.checks.find((c: { name: string }) => c.name.includes("ROE"));
    const debt = r.checks.find((c: { name: string }) => c.name.includes("资产负债率"));
    const cap = r.checks.find((c: { name: string }) => c.name.includes("资本充足率"));
    expect(roe?.ok).toBe(true);   // 豁免
    expect(debt?.ok).toBe(true);  // 豁免
    expect(cap?.ok).toBe(true);   // 12.48 ≥ 8
    expect(cap?.desc).toContain("12.48");
  });
  it("资本充足率不足 → 银行专项不通过", () => {
    const r = checkFundamentals(mockF({ SECURITY_NAME_ABBR: "浦发银行", ROEJQ: 2.3, ZCFZL: 91.8, NEWCAPITALADER: 7.5 }));
    const cap = r.checks.find((c: { name: string }) => c.name.includes("资本充足率"));
    expect(cap?.ok).toBe(false);
  });
  it("desc 双字段人类可读（可喂 LLM）", () => {
    const r = checkFundamentals(mockF());
    for (const c of r.checks as Array<{ name: string; desc: string; ok: boolean }>) {
      expect(typeof c.desc).toBe("string");
      expect(c.desc.length).toBeGreaterThan(5);
      expect(typeof c.ok).toBe("boolean");
    }
  });
});

describe("v9.98.0 computeRightPrice 合理价 + 空窗回退", () => {
  it("年报 EPS × (1+增速) × 基准 PE", () => {
    const r = computeRightPrice(mockF());
    // 0.72 × 1.12 × 20 = 16.128
    expect(r.rightPrice).toBeCloseTo(16.13, 2);
    expect(r.priceSpace).toBeCloseTo(34.4, 1); // (16.128-12)/12
  });
  it("最新期无年报时回退（空窗）", () => {
    const f = mockF() as { latest: Record<string, unknown>; annual: Record<string, unknown> | null; valuation: Record<string, unknown>; name: string | null };
    f.annual = null; // 空窗：最新期是 Q1
    const r = computeRightPrice(f);
    // 用 latest.EPSJB 0.8 × 1.153 × 20 = 18.45
    expect(r.rightPrice).toBeCloseTo(18.45, 1);
  });
  it("EPS 亏损 → 不适用", () => {
    const f = mockF();
    f.annual = { ...f.annual!, EPSJB: -0.5 }; // 年报亏损
    const r = computeRightPrice(f);
    expect(r.rightPrice).toBeNull();
  });
});

describe("v9.98.0 DEFAULT_OPTIONS 阈值表", () => {
  it("investool 对照默认值", () => {
    expect(DEFAULT_OPTIONS.minROE).toBe(8);
    expect(DEFAULT_OPTIONS.maxDebtAssetRatio).toBe(60);
    expect(DEFAULT_OPTIONS.maxPEG).toBe(1.5);
    expect(DEFAULT_OPTIONS.minTotalMarketCap).toBe(100e8);
    expect(DEFAULT_OPTIONS.bankMinCapitalAdequacy).toBe(8);
  });
});

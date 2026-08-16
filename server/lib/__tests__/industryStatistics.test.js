// v9.150.0（P2-4）：外部统计口径数据适配器 —— 网络层注入 mock，验证真实落库路径
import { describe, it, expect, vi } from "vitest";
import { syncIndustryMacroSignals } from "../industryStatistics";

const SAMPLE_ROWS = [
  {
    month: "2026年07月份",
    manufacturing_pmi: "49.2000",
    manufacturing_yoy: "-0.2028",
    manufacturing_mom: "-2.1869",
    non_manufacturing_pmi: "49.0000",
    non_manufacturing_yoy: "-2.1956",
    non_manufacturing_mom: "-2.3904",
    export_current: "3978.5171",
    export_yoy: "23.9000",
    export_mom: "-3.5247",
    import_current: "2853.5311",
    import_yoy: "23.9000",
    import_mom: "-0.4920",
    national_cpi: "100.3000",
    national_yoy: "0.4000",
    national_mom: "0.1000",
    ppi: "98.9000",
    yoy: "-1.1000",
    mom: "0.0000",
    investment: "30000.0000",
  },
];

describe("industryStatistics.syncIndustryMacroSignals", () => {
  it("把外部网关返回的月度统计写入 industry_macro_signal", async () => {
    const pool = { query: vi.fn(async () => ({ rowCount: 1 })) };
    const getJson = vi.fn(async () => ({ data: { data: SAMPLE_ROWS } }));

    const out = await syncIndustryMacroSignals(pool, { _getJson: getJson });

    expect(out.failed).toEqual([]);
    expect(out.ok).toHaveLength(6);
    expect(getJson).toHaveBeenCalled();
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain("INSERT INTO industry_macro_signal");
    expect(sql).toContain("ON CONFLICT(indicator,period)");
  });

  it("外部网关失败时返回 failed，不抛出阻塞启动", async () => {
    const pool = { query: vi.fn(async () => ({ rowCount: 1 })) };
    const getJson = vi.fn(async () => { throw new Error("upstream timeout"); });

    const out = await syncIndustryMacroSignals(pool, { _getJson: getJson });

    expect(out.failed).toHaveLength(6);
    expect(out.ok).toHaveLength(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

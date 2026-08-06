// v9.60（V9-D1/D2/D3）：数据可靠性测试
// D1：关键资金字段缺失检测（hasMissingKeyFields）+ 折叠聚合透传（foldBoardFunds.dataMissing）
// D2：Math.max(...空数组) 防空（safeMax 空数组时返回 0 而非 -Infinity）
// D3：北京时间工具（getBJDate/getBJWeekday）—— 非东八区机器上日期/周末仍按北京时间
import { describe, it, expect } from "vitest";
import { hasMissingKeyFields } from "../api";
import { foldBoardFunds } from "../conceptGroups";
import { safeMax } from "../stockToMainline";
import { getBJDate, getBJWeekday, getBJDateStr } from "../format";
import { bjDateStr, isTradingDay } from "../tradeCalendar";

describe("V9-D1 关键字段缺失检测（东财改字段 → 可感知而非静默 0）", () => {
  it("字段齐全 → 不缺失", () => {
    const d = { f62: 123456, f164: 88888, f174: 99999, f3: 2.5, f184: 3.1 };
    expect(hasMissingKeyFields(d, ["f62", "f164", "f174", "f3", "f184"])).toBe(false);
  });

  it("f62 缺失（undefined）→ 缺失", () => {
    const d = { f164: 88888, f174: 99999 };
    expect(hasMissingKeyFields(d, ["f62", "f164", "f174"])).toBe(true);
  });

  it("f62 为 null → 缺失", () => {
    const d = { f62: null, f164: 88888, f174: 99999 };
    expect(hasMissingKeyFields(d, ["f62", "f164", "f174"])).toBe(true);
  });

  it("f62 为字符串空 → 缺失", () => {
    const d = { f62: "", f164: 88888, f174: 99999 };
    expect(hasMissingKeyFields(d, ["f62", "f164", "f174"])).toBe(true);
  });

  it("f62 为 '-'（东财占位符，非数字）→ 缺失", () => {
    const d = { f62: "-", f164: 88888, f174: 99999 };
    expect(hasMissingKeyFields(d, ["f62", "f164", "f174"])).toBe(true);
  });

  it("任一字段缺失即整体缺失（f174 缺失）", () => {
    const d = { f62: 123456, f164: 88888 };
    expect(hasMissingKeyFields(d, ["f62", "f164", "f174"])).toBe(true);
  });

  it("部分字段查询（只关注 f62）时其他字段缺失不影响", () => {
    const d = { f62: 123456 };
    expect(hasMissingKeyFields(d, ["f62"])).toBe(false);
  });
});

describe("V9-D1 foldBoardFunds 折叠聚合透传 dataMissing", () => {
  it("成员板块无缺失 → 聚合结果无缺失标记", () => {
    const map = foldBoardFunds([
      { name: "人工智能", pct: 2, mainNet: 1e9 },
      { name: "大模型", pct: 3, mainNet: 2e9 },
    ]);
    expect(map.get("AI应用")?.dataMissing).toBeUndefined();
  });

  it("任一成员 dataMissing=true → 聚合结果也标记缺失（不掩盖局部字段缺失）", () => {
    const map = foldBoardFunds([
      { name: "人工智能", pct: 2, mainNet: 1e9, dataMissing: true },
      { name: "大模型", pct: 3, mainNet: 2e9 },
    ]);
    expect(map.get("AI应用")?.dataMissing).toBe(true);
  });

  it("单个板块折叠后 dataMissing 保真（白酒→大消费）", () => {
    const map = foldBoardFunds([
      { name: "白酒", pct: -1, mainNet: -5e8, dataMissing: true },
    ]);
    expect(map.get("大消费")?.dataMissing).toBe(true);
  });
});

describe("V9-D2 safeMax 防空（空数组不再返回 -Infinity）", () => {
  it("空数组 → 返回 0 而非 -Infinity", () => {
    expect(safeMax([])).toBe(0);
    expect(Number.isFinite(safeMax([]))).toBe(true);
  });

  it("非空数组 → 正常返回最大值", () => {
    expect(safeMax([3, 1, 2])).toBe(3);
  });

  it("单元素数组 → 返回该元素", () => {
    expect(safeMax([5])).toBe(5);
  });

  it("全是 0 → 返回 0（非 -Infinity）", () => {
    expect(safeMax([0, 0])).toBe(0);
  });
});

describe("V9-D3 北京时间工具（非东八区机器上日期/周末仍按北京时间）", () => {
  it("getBJDateStr：UTC 凌晨 2026-08-06T00:30Z（北京 08:30）→ 北京日期 2026-08-06 而非 UTC 的 08-06", () => {
    // UTC 2026-08-06 00:30 = 北京 2026-08-06 08:30（同日）
    const utcMorning = new Date("2026-08-06T00:30:00Z");
    expect(getBJDateStr(utcMorning)).toBe("2026-08-06");
  });

  it("getBJDateStr：UTC 前一天傍晚 2026-08-05T18:00Z（北京 08-06 02:00）→ 北京日期 2026-08-06", () => {
    // 关键：UTC 还是 8/5 晚上，北京已跨到 8/6 凌晨 —— 本机 getDay/getDate 会读成 8/5，getBJDate 必须纠正为 8/6
    const utcEvening = new Date("2026-08-05T18:00:00Z");
    expect(getBJDateStr(utcEvening)).toBe("2026-08-06");
  });

  it("getBJWeekday：UTC 2026-08-05T18:00Z（北京 8/6 周四）→ 周四(4)", () => {
    // 2026-08-06 是周四。北京时间 8/6 02:00 → getBJWeekday 应为 4（周四），
    // 而不是本机(UTC)的 8/5 周三(3)——这正是 D3 要修的偏移。
    const utcEvening = new Date("2026-08-05T18:00:00Z");
    expect(getBJWeekday(utcEvening)).toBe(4);
  });

  it("getBJDate：返回的 Date 其 getDay 反映北京时间而非本机时区", () => {
    const utcEvening = new Date("2026-08-05T18:00:00Z"); // 北京已是 8/6
    const bj = getBJDate(utcEvening);
    expect(bj.getDate()).toBe(6); // 北京日期 8/6
    expect(bj.getDay()).toBe(4);  // 周四
  });
});
describe("V9-D3 交易时段/交易日历回归（修复 v9.55 时区 bug）", () => {
  it("getBJDate 北京 22 点 → 22 点（原 bug：读到 UTC 14 点判成盘中）", () => {
    const bj = getBJDate(new Date("2026-08-06T22:00:00+08:00"));
    expect(bj.getHours()).toBe(22);
    expect(bj.getDay()).toBe(4); // 周四
  });

  it("bjDateStr 北京凌晨 00:30（UTC 前日 16:30）→ 北京日期不跨天", () => {
    const d = new Date("2026-08-06T00:30:00+08:00"); // 北京 8/6 凌晨 = UTC 8/5 16:30
    expect(bjDateStr(d)).toBe("2026-08-06");
  });

  it("isTradingDay 北京周六 → false（周末判定按北京而非 UTC）", () => {
    // 北京 8/8 周六 23:00 = UTC 8/8 15:00（同一天没问题）
    expect(isTradingDay(new Date("2026-08-08T23:00:00+08:00"))).toBe(false);
    // 关键：北京 8/8 周六凌晨 00:30 = UTC 8/7 16:30（UTC 还是周五！原 bug 会判成交易日）
    expect(isTradingDay(new Date("2026-08-08T00:30:00+08:00"))).toBe(false);
  });

  it("getBJDate 在任意时区输入下返回北京字段（UTC 傍晚 → 北京次日凌晨）", () => {
    const utcEvening = new Date("2026-08-05T18:00:00Z"); // UTC 8/5 18:00 = 北京 8/6 02:00
    const bj = getBJDate(utcEvening);
    expect(bj.getDate()).toBe(6);
    expect(bj.getDay()).toBe(4); // 周四
    expect(bj.getHours()).toBe(2);
  });
});

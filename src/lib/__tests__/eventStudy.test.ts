// v9.101.1（T-D3）：事件研究纯函数单测
import { describe, it, expect } from "vitest";
import { runEventStudy, type EventRecord, type BoardDaily } from "../eventStudy";

describe("v9.101.1 runEventStudy（次日/3日统计）", () => {
  const events: EventRecord[] = [
    { type: "政策", direction: "利好", date: "2026-08-03" },
    { type: "政策", direction: "利好", date: "2026-08-04" },
    { type: "制裁", direction: "利空", date: "2026-08-05" },
  ];
  const dailies: BoardDaily[] = [
    { board: "半导体", date: "2026-08-04", pct: 3.2 },
    { board: "半导体", date: "2026-08-05", pct: -1.1 },
    { board: "半导体", date: "2026-08-06", pct: 2.0 },
    { board: "半导体", date: "2026-08-07", pct: 1.5 },
    { board: "半导体", date: "2026-08-08", pct: -0.5 },
  ];

  it("按类型+方向聚合，次日/3日平均与胜率正确", () => {
    const r = runEventStudy(events, dailies, "半导体");
    // 政策|利好：事件 08-03→次日 08-04(+3.2)/3日 08-06(+2.0)；08-04→次日 08-05(-1.1)/3日 08-07(+1.5)
    const policy = r.find(x => x.key === "政策|利好");
    expect(policy).toBeDefined();
    expect(policy!.samples).toBe(2);
    expect(policy!.nextDayAvg).toBeCloseTo(1.05, 1); // (3.2-1.1)/2
    expect(policy!.nextDayWinRate).toBe(50);
    expect(policy!.day3Avg).toBeCloseTo(1.75, 1); // (2.0+1.5)/2
    expect(policy!.day3WinRate).toBe(100);
    expect(policy!.summary).toContain("2 次同类事件后板块次日平均 1.1%");
    // 制裁|利空：事件 08-05→次日 08-06(+2.0)/3日 08-08(-0.5)
    const sanction = r.find(x => x.key === "制裁|利空");
    expect(sanction).toBeDefined();
    expect(sanction!.nextDayAvg).toBe(2.0);
  });

  it("无事件/无板块数据 → 空结果", () => {
    expect(runEventStudy([], dailies, "半导体")).toHaveLength(0);
    expect(runEventStudy(events, [], "半导体")).toHaveLength(0);
  });

  it("事件次日无板块数据 → 该组被过滤（无样本支撑不输出）", () => {
    const ev2: EventRecord[] = [{ type: "外围", direction: "利好", date: "2026-09-01" }];
    const r = runEventStudy(ev2, dailies, "半导体");
    expect(r).toHaveLength(0);
  });
});

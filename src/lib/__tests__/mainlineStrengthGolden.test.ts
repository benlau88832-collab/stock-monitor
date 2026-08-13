// ============================================================
// v9.136.0（主线单源）：主线强度分双端 golden ——
//   前端 src/lib/mainlineScore.ts（calcMainlineStrength）↔ 服务端 server/lib/mainlineStrength.js
//   逐公式一致锁定（单侧改动必红）。历史教训：双引擎排序键漂移导致认知横幅/作战卡同屏不同名。
//   服务端为 CJS 同构实现（TS 模块 server 无法 require，项目既有模式）。
// ============================================================
import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { calcMainlineStrength } from "../mainlineScore";

const require = createRequire(import.meta.url);
const BE = require("../../../server/lib/mainlineStrength.js");

describe("v9.136.0 主线强度分双端 golden（主线单源）", () => {
  // 六维全覆盖的典型输入（ztCount 占比/高度/资金/催化）
  const CASES: Array<{ name: string; input: Parameters<typeof calcMainlineStrength>[0] }> = [
    { name: "全数据·强主线", input: { ztCount: 20, totalZtCount: 100, height: 6, totalMaxHeight: 6, promotionRate: 0.5, mainNet5d: 5e8, mainNet10d: 8e8, boardPct: 5, turnoverRate: 5, catalystStrength: 80 } },
    { name: "缺 10 日资金/换手/催化（中性 50）", input: { ztCount: 8, totalZtCount: 80, height: 3, totalMaxHeight: 5, promotionRate: 0.3, mainNet5d: -1e8, mainNet10d: null, boardPct: 1, turnoverRate: null, catalystStrength: null } },
    { name: "晋级率缺失（中性 50）", input: { ztCount: 5, totalZtCount: 60, height: 2, totalMaxHeight: 4, promotionRate: null, mainNet5d: 0, mainNet10d: null, boardPct: 0, turnoverRate: null, catalystStrength: 60 } },
    { name: "空市场（totalZt=0 分支）", input: { ztCount: 1, totalZtCount: 0, height: 2, totalMaxHeight: 0, promotionRate: null, mainNet5d: 0, mainNet10d: null, boardPct: 0, turnoverRate: null, catalystStrength: null } },
    { name: "换手三档边界（8.1→分歧 60）", input: { ztCount: 12, totalZtCount: 90, height: 4, totalMaxHeight: 6, promotionRate: 0.4, mainNet5d: 2e8, mainNet10d: 1e8, boardPct: 3, turnoverRate: 8.1, catalystStrength: 50 } },
    { name: "资金大额净流出", input: { ztCount: 10, totalZtCount: 100, height: 3, totalMaxHeight: 7, promotionRate: 0.2, mainNet5d: -5e8, mainNet10d: -3e8, boardPct: -2, turnoverRate: 2, catalystStrength: 30 } },
  ];

  for (const c of CASES) {
    it(`${c.name}：score/factors/tier 双端一致`, () => {
      const fe = calcMainlineStrength(c.input);
      const be = BE.calcMainlineStrength(c.input);
      expect(be.score).toBe(fe.score);
      expect(be.tier).toBe(fe.tier);
      expect(be.factors).toEqual(fe.factors);
    });
  }

  it("排序键 golden：strength 降序 + heat tie-breaker", () => {
    const ranked = BE.rankThemesByStrength([
      { theme: "A", strength: 60, heat: 10 },
      { theme: "B", strength: 80, heat: 5 },
      { theme: "C", strength: 60, heat: 30 },
      { theme: "D", strength: 80, heat: 5 }, // 与 B 同分同热 → name 升序
    ]);
    expect(ranked.map((t: { theme: string }) => t.theme)).toEqual(["B", "D", "C", "A"]);
  });

  it("旧数据兼容：无 strength 字段 → 按 heat 排序（cron 补跑前不跳变）", () => {
    const ranked = BE.rankThemesByStrength([
      { theme: "X", heat: 20 },
      { theme: "Y", heat: 45 },
    ]);
    expect(ranked[0].theme).toBe("Y");
  });
});

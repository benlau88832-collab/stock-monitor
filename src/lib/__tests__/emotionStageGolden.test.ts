// ============================================================
// v9.129.0（一致性收敛）：情绪周期判定双端同构 golden ——
//   前端 src/lib/emotionStage.ts deriveStage ↔ 服务端 server/lib/cognition.js deriveSentimentStage
//   全输入空间锁定：单侧改动必红（防"统一后再次漂移"，历史教训：thresholds.ts/stageModel
//   曾声称统一但无人引用 golden，多套判定长期并存）。
// ============================================================
import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { deriveStage, EMOTION_STAGES } from "../emotionStage";

const require = createRequire(import.meta.url);
const { deriveSentimentStage } = require("../../../server/lib/cognition.js");

describe("v9.129.0 情绪周期判定双端同构（golden 全输入空间）", () => {
  it("score 0-100 × premium -5..5 × blasted 0-100 全组合一致", () => {
    let checked = 0;
    for (let s = 0; s <= 100; s += 2) {
      for (let p = -5; p <= 5; p += 1) {
        for (let b = 0; b <= 100; b += 5) {
          // 前端入参炸板率 %（0-100），服务端入参 0-1 比率
          const fe = deriveStage(s, p, b);
          const srv = deriveSentimentStage(s, p, b / 100);
          expect(fe, `score=${s} premium=${p} blasted=${b}`).toBe(srv);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(10000);
  });

  it("null 容错一致：premium/blasted 为 null 按 0 处理", () => {
    expect(deriveStage(16, null, null)).toBe("冰点");
    expect(deriveStage(16, null, null)).toBe(deriveSentimentStage(16, 0, 0));
    expect(deriveStage(75, null, 8)).toBe(deriveSentimentStage(75, 0, 0.08));
  });

  it("词表恒为六词", () => {
    expect(EMOTION_STAGES).toEqual(["冰点", "退潮", "启动", "发酵", "高潮", "分歧"]);
  });
});

// v9.150.0（P2-1）：研报覆盖/评级数量趋势按月聚合
import { describe, it, expect, vi } from "vitest";
import { fetchResearchRatingTrendServer } from "../researchData";

describe("researchData.fetchResearchRatingTrendServer", () => {
  it("把东财研报列表按月份聚合为覆盖趋势", async () => {
    const getJson = vi.fn(async () => ({
      data: {
        data: [
          { title: "a", orgSName: "华泰", publishDate: "2026-08-10 08:00:00", emRatingName: "买入" },
          { title: "b", orgSName: "中金", publishDate: "2026-08-12 09:00:00", sRatingName: "增持" },
          { title: "c", orgSName: "招商", publishDate: "2026-07-05 10:00:00", emRatingName: "买入" },
        ],
      },
    }));

    const out = await fetchResearchRatingTrendServer("600519", 200, getJson);

    expect(out).toHaveLength(2);
    expect(out[0].month).toBe("2026-07");
    expect(out[0].total).toBe(1);
    expect(out[0].ratings["买入"]).toBe(1);
    expect(out[1]).toMatchObject({ month: "2026-08", total: 2, ratings: { "买入": 1, "增持": 1 } });
  });

  it("网络失败返回空数组，不阻塞基本面卡", async () => {
    const getJson = vi.fn(async () => { throw new Error("http 503"); });
    const out = await fetchResearchRatingTrendServer("600519", 200, getJson);
    expect(out).toEqual([]);
  });
});

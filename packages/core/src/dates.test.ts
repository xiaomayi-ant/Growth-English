import { describe, expect, it } from "vitest";
import { buildReviewDates, reviewOffsetForRound, todayInTimeZone } from "./dates.js";

// 界面上的 D 记号说的是「学习后第几天」，不是第几轮。把轮次号直接当天数，
// 第 2 轮会显示成 D2（实际 D3）、第 3 轮显示 D3（实际 D7），越往后偏得越远。
describe("reviewOffsetForRound", () => {
  it("maps each round to the day it actually falls on", () => {
    expect([1, 2, 3, 4, 5].map(reviewOffsetForRound)).toEqual([1, 3, 7, 14, 21]);
  });

  it("agrees with the schedule buildReviewDates produces", () => {
    for (const date of buildReviewDates("2026-07-06")) {
      expect(reviewOffsetForRound(date.roundNumber)).toBe(date.offsetDays);
    }
  });

  it("returns null outside the five rounds instead of guessing", () => {
    expect(reviewOffsetForRound(0)).toBeNull();
    expect(reviewOffsetForRound(6)).toBeNull();
  });
});

describe("review dates", () => {
  it("builds the fixed five-round schedule", () => {
    expect(buildReviewDates("2026-07-06")).toEqual([
      { roundNumber: 1, offsetDays: 1, scheduledOn: "2026-07-07", effectiveDueOn: "2026-07-07" },
      { roundNumber: 2, offsetDays: 3, scheduledOn: "2026-07-09", effectiveDueOn: "2026-07-09" },
      { roundNumber: 3, offsetDays: 7, scheduledOn: "2026-07-13", effectiveDueOn: "2026-07-13" },
      { roundNumber: 4, offsetDays: 14, scheduledOn: "2026-07-20", effectiveDueOn: "2026-07-20" },
      { roundNumber: 5, offsetDays: 21, scheduledOn: "2026-07-27", effectiveDueOn: "2026-07-27" },
    ]);
  });

  // 周末照常学习，复习日也就不再跳过周末：从周四学起，D3 落在周日就是周日
  it("keeps review dates on weekends instead of deferring them", () => {
    const [d1, d3] = buildReviewDates("2026-07-09");
    expect(d1).toMatchObject({ scheduledOn: "2026-07-10", effectiveDueOn: "2026-07-10" });
    expect(d3).toMatchObject({ scheduledOn: "2026-07-12", effectiveDueOn: "2026-07-12" });
  });

  it("formats today in the configured timezone", () => {
    expect(todayInTimeZone("Asia/Shanghai", new Date("2026-07-10T16:30:00Z"))).toBe("2026-07-11");
  });
});

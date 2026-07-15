import { describe, expect, it } from "vitest";
import { buildReviewDates, nextWorkday, todayInTimeZone } from "./dates.js";

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

  it("moves weekend dates to Monday", () => {
    expect(nextWorkday("2026-07-11")).toBe("2026-07-13");
    expect(nextWorkday("2026-07-12")).toBe("2026-07-13");
  });

  it("formats today in the configured timezone", () => {
    expect(todayInTimeZone("Asia/Shanghai", new Date("2026-07-10T16:30:00Z"))).toBe("2026-07-11");
  });
});

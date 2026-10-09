import { expect, test } from "vitest";
import {
  midnight,
  splitInterval,
  clockMinutes,
  addDays,
} from "@/lib/analytics/time";

test("memoized calendar boundaries preserve DST and fractional UTC offsets", () => {
  const cases = [
    ["2025-03-09", "America/New_York", "2025-03-09T05:00:00Z"],
    ["2025-03-10", "America/New_York", "2025-03-10T04:00:00Z"],
    ["2025-11-02", "America/New_York", "2025-11-02T04:00:00Z"],
    ["2025-11-03", "America/New_York", "2025-11-03T05:00:00Z"],
    ["2025-01-01", "Asia/Kolkata", "2024-12-31T18:30:00Z"],
    ["2025-01-01", "Asia/Kathmandu", "2024-12-31T18:15:00Z"],
    ["2012-01-01", "Pacific/Apia", "2011-12-31T10:00:00Z"],
  ] as const;
  for (const [day, tz, expected] of cases) {
    expect(midnight(day, tz)).toBe(Date.parse(expected));
    expect(midnight(day, tz)).toBe(Date.parse(expected));
  }
  const spring = splitInterval(
    "2025-03-09T05:00:00Z",
    "2025-03-10T04:00:00Z",
    "America/New_York",
  );
  expect(spring).toHaveLength(1);
  expect((spring[0].end - spring[0].start) / 3600000).toBe(23);
  const autumn = splitInterval(
    "2025-11-02T04:00:00Z",
    "2025-11-03T05:00:00Z",
    "America/New_York",
  );
  expect(autumn).toHaveLength(1);
  expect((autumn[0].end - autumn[0].start) / 3600000).toBe(25);
});

test("calendar cache eviction and switching timezone retain exact UTC results", () => {
  const original = midnight("2025-03-09", "America/New_York");
  for (let i = 0; i < 4200; i++) midnight(addDays("2000-01-01", i), "UTC");
  expect(midnight("2025-03-09", "America/New_York")).toBe(original);
  expect(clockMinutes("2025-01-01T00:00:00Z", "Asia/Kolkata")).toBe(330);
  expect(clockMinutes("2025-01-01T00:00:00Z", "UTC")).toBe(0);
  expect(() => midnight("2025-01-01", "invalid/timezone")).toThrow();
});

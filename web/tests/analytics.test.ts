import { describe, it, expect } from "vitest";
import { buildDataset, readiness, type Day } from "@/lib/analytics/engine";
import {
  median,
  robustBaseline,
  association,
  spearman,
} from "@/lib/analytics/statistics";
import { localDay, splitInterval, midnight } from "@/lib/analytics/time";
import { demoDataset } from "@/lib/data/demo";
import { dashboardQuery, factSchema, type Fact } from "@/lib/data/schema";
const now = new Date("2025-05-10T12:00:00Z"),
  inventory = { inventory: [], sync: null };
const fact = (overrides: Partial<Fact> = {}): Fact => ({
  id: "synthetic-a",
  kind: "steps",
  provider: "health_connect",
  origin: "live",
  source: "synthetic.example",
  channel: "synthetic-watch",
  rank: 300,
  start: "2025-05-10T00:00:00Z",
  end: "2025-05-10T01:00:00Z",
  received: now.toISOString(),
  value: 100,
  samples: 1,
  min: null,
  max: null,
  sessions: [],
  hourly: [],
  supported: true,
  bodyFat: null,
  ...overrides,
});
const run = (facts: Fact[]) =>
  buildDataset(facts, inventory, { days: 7, timezone: "UTC", now });
describe("canonical observations", () => {
  it("never adds watch, phone and another provider step channels", () => {
    const result = run([
      fact(),
      fact({
        id: "synthetic-phone",
        channel: "synthetic-phone",
        rank: 200,
        value: 200,
      }),
      fact({
        id: "synthetic-hc",
        channel: "synthetic-secondary",
        rank: 100,
        value: 900,
      }),
    ]);
    expect(result.days.at(-1)?.steps).toBe(100);
  });
  it("deduplicates identical identities but withholds overlapping different identities", () => {
    expect(run([fact(), fact()]).days.at(-1)?.steps).toBe(100);
    const result = run([
      fact(),
      fact({ id: "synthetic-distinct", value: 500 }),
    ]);
    expect(result.days.at(-1)?.steps).toBeNull();
    expect(result.excludedOverlaps).toBe(2);
  });
  it("does not turn absent dates into zero", () => {
    expect(run([fact()]).days[0].steps).toBeNull();
  });
  it("selects sleep provider without summing the secondary representation", () => {
    const session = {
      start: "2025-05-09T23:00:00Z",
      end: "2025-05-10T07:00:00Z",
      minutes: 450,
      stages: {},
      durationBasis: "vendor_duration" as const,
      category: "sleep",
    };
    const result = run([
      fact({
        kind: "sleep",
        value: null,
        provider: "samsung_health",
        sessions: [session],
      }),
      fact({
        id: "synthetic-secondary",
        kind: "sleep",
        value: null,
        sessions: [{ ...session, minutes: 460 }],
      }),
    ]);
    expect(result.days.at(-1)?.sleep).toBe(450);
  });
  it("assigns sleep by local wake date and excludes unrecognized physiological aliases", () => {
    const result = buildDataset(
      [
        fact({
          kind: "sleep",
          value: null,
          sessions: [
            {
              start: "2025-05-09T18:00:00Z",
              end: "2025-05-10T00:00:00Z",
              minutes: 350,
              stages: {},
              durationBasis: "vendor_duration",
              category: "sleep",
            },
          ],
        }),
        fact({ id: "synthetic-vendor", kind: "hrv_envelope", value: 55 }),
      ],
      inventory,
      { days: 7, timezone: "Asia/Kolkata", now },
    );
    expect(result.days.at(-1)?.sleep).toBe(350);
    expect(result.days.at(-1)?.hrv).toBeNull();
  });
  it("does not call arbitrary daytime heart rate resting HR", () => {
    const result = run([fact({ kind: "heart_rate", value: 90, samples: 100 })]);
    expect(result.days.at(-1)?.hr).toBe(90);
    expect(result.days.at(-1)?.overnightHr).toBeNull();
  });
  it("preserves valid unusual readings but rejects invalid units/domains", () => {
    expect(
      run([fact({ kind: "weight", value: 240 })]).days.at(-1)?.weight,
    ).toBe(240);
    expect(
      run([fact({ kind: "blood_oxygen", value: 180 })]).days.at(-1)?.spo2,
    ).toBeNull();
  });
  it("sparse weight does not manufacture smoothed history or a weekly rate", () => {
    const result = run([fact({ kind: "weight", value: 75 })]);
    expect(result.days.at(-1)?.weightSmooth).toBeNull();
    expect(result.weightChange).toBeNull();
  });
});
describe("time and uncertainty", () => {
  it("uses explicit offsets and display timezone across midnight", () => {
    expect(localDay("2025-05-09T23:00:00-04:00", "Asia/Kolkata")).toBe(
      "2025-05-10",
    );
    const slices = splitInterval(
      "2025-05-09T23:00:00Z",
      "2025-05-10T01:00:00Z",
      "UTC",
    );
    expect(slices.map((x) => x.fraction)).toEqual([0.5, 0.5]);
  });
  it("handles a 23-hour DST date without the hosting timezone", () => {
    expect(
      midnight("2025-03-10", "America/New_York") -
        midnight("2025-03-09", "America/New_York"),
    ).toBe(23 * 3600000);
  });
  it("validates range and IANA timezone", () => {
    expect(
      dashboardQuery.safeParse({ days: 900, timezone: "UTC" }).success,
    ).toBe(false);
    expect(
      dashboardQuery.safeParse({ days: 28, timezone: "invented" }).success,
    ).toBe(false);
  });
  it("computes robust baselines without an outlier driving the center", () => {
    expect(median([1, 2, 3, 999])).toBe(2.5);
    expect(robustBaseline([10, 10, 11, 12, 999]).median).toBe(11);
  });
  it("withholds readiness on insufficient core coverage and partial summaries", () => {
    const demo = demoDataset(90, "UTC", "normal", now);
    expect(demo.readiness.score).not.toBeNull();
    expect(demoDataset(90, "UTC", "sparse", now).readiness.score).toBeNull();
    expect(demoDataset(90, "UTC", "partial", now).readiness.score).toBeNull();
    const missing = demo.days.map((day, i) => ({
      ...day,
      hrv: i % 2 ? null : day.hrv,
    }));
    expect(readiness(missing, false).score).toBeNull();
  });
  it("withholds inference with too few samples, constant inputs or weak coverage", () => {
    expect(
      association(
        Array.from({ length: 29 }, (_, i) => [i, i] as [number, number]),
        29,
      ),
    ).toBeNull();
    expect(
      association(
        Array.from({ length: 35 }, (_, i) => [i, i] as [number, number]),
        90,
      ),
    ).toBeNull();
    expect(
      spearman([
        [1, 2],
        [1, 3],
        [1, 4],
      ]),
    ).toBeNull();
  });
  it("provides deterministic uncertainty for strong supported associations", () => {
    const pairs = Array.from(
      { length: 60 },
      (_, i) => [i, i + Math.sin(i)] as [number, number],
    );
    expect(association(pairs, 60)?.low).toBeGreaterThan(0);
    expect(association(pairs, 60)).toEqual(association(pairs, 60));
  });
  it("bounded normalized facts reject giant arrays and non-finite values", () => {
    expect(factSchema.safeParse(fact({ value: Infinity })).success).toBe(false);
    expect(
      factSchema.safeParse(
        fact({
          hourly: Array(1001).fill({
            start: now.toISOString(),
            end: now.toISOString(),
            mean: 60,
            count: 1,
          }),
        }),
      ).success,
    ).toBe(false);
  });
  it("missing sleep stages remain empty rather than fabricated", () => {
    const empty = demoDataset(28, "UTC", "empty", now);
    expect(
      empty.days.every((d: Day) => Object.keys(d.stages).length === 0),
    ).toBe(true);
  });
});

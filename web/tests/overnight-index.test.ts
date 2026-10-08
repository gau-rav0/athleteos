import { expect, test } from "vitest";
import { buildDataset } from "@/lib/analytics/engine";
import type { Fact } from "@/lib/data/schema";
import { localDay } from "@/lib/analytics/time";
const now = new Date("2025-05-10T18:00:00Z");
const sleepStart = "2025-05-09T22:00:00Z",
  sleepEnd = "2025-05-10T06:00:00Z";
const fact = (changes: Partial<Fact> = {}): Fact => ({
  id: "synthetic-hr",
  kind: "heart_rate",
  provider: "health_connect",
  origin: "live",
  source: "synthetic.example",
  channel: "synthetic-watch",
  rank: 300,
  start: sleepStart,
  end: sleepEnd,
  received: now.toISOString(),
  value: 60,
  samples: 20,
  min: null,
  max: null,
  sessions: [],
  hourly: [],
  supported: true,
  bodyFat: null,
  ...changes,
});
const bucket = (mean = 60, count = 20, start = sleepStart, end = sleepEnd) => ({
  start,
  end,
  mean,
  count,
});
const session = (start = sleepStart, end = sleepEnd) => ({
  start,
  end,
  minutes: (Date.parse(end) - Date.parse(start)) / 60000,
  stages: { light: 480 },
  durationBasis: "known_stages" as const,
  category: "sleep",
});
// Frozen prior traversal: scans original facts/buckets in order, retaining the
// first eligible channel rank/source. Deliberately includes duplicate IDs and
// unsupported HC facts, matching existing overnight semantics independently.
function originalOvernight(facts: Fact[], kept: ReturnType<typeof session>[]) {
  const hourly = new Map<
    string,
    { rank: number; sum: number; count: number; source: string }
  >();
  for (const f of facts) {
    if (f.provider !== "health_connect" || f.kind !== "heart_rate") continue;
    for (const b of f.hourly) {
      if (
        !b.count ||
        !kept.some(
          (s) =>
            Date.parse(b.start) >= Date.parse(s.start) &&
            Date.parse(b.end) <= Date.parse(s.end),
        )
      )
        continue;
      const group = hourly.get(f.channel) || {
        rank: f.rank,
        sum: 0,
        count: 0,
        source: `Health Connect · ${f.source}`,
      };
      group.sum += b.mean * b.count;
      group.count += b.count;
      hourly.set(f.channel, group);
    }
  }
  const best = [...hourly.values()].sort((a, b) => b.rank - a.rank)[0];
  return best && best.count >= 20
    ? { value: best.sum / best.count, count: best.count, source: best.source }
    : { value: null, count: undefined, source: undefined };
}
function compare(
  facts: Fact[],
  sessions = [session()],
  timezone = "UTC",
  partial = false,
) {
  const withSleep = [
    fact({ id: "synthetic-sleep", kind: "sleep", value: null, sessions }),
    ...facts,
  ];
  const result = buildDataset(
    withSleep,
    { inventory: [], sync: null },
    { days: 7, timezone, now, partial },
  );
  const day = result.days.find(
    (d) => d.day === localDay(sessions[0].end, timezone),
  )!;
  const expected = originalOvernight(withSleep, sessions);
  expect(day.overnightHr).toBe(expected.value);
  expect(day.sampleCounts.overnightHr).toBe(expected.count);
  expect(day.sources.overnightHr).toBe(expected.source);
  return result;
}
test("preserves original channel ties, duplicate identities, buckets and unsupported inclusion", () => {
  const repeated = bucket(50, 10);
  compare([
    fact({ channel: "first", rank: 400, hourly: [repeated, repeated] }),
    fact({
      channel: "first",
      rank: 999,
      supported: false,
      hourly: [bucket(70, 20)],
    }),
    fact({
      id: "synthetic-other",
      channel: "second",
      rank: 400,
      hourly: [bucket(90, 20)],
    }),
    fact({
      id: "synthetic-samsung",
      provider: "samsung_health",
      rank: 1000,
      hourly: [bucket(99, 100)],
    }),
  ]);
});
test("later rank in an existing channel does not replace its first eligible rank", () => {
  compare([
    fact({ channel: "first", rank: 100, hourly: [bucket(50)] }),
    fact({ channel: "first", rank: 999, hourly: [bucket(70)] }),
    fact({
      id: "synthetic-second",
      channel: "second",
      rank: 500,
      hourly: [bucket(90)],
    }),
  ]);
});
test("includes exact containment boundaries and excludes crossing and malformed buckets", () => {
  compare([
    fact({
      hourly: [
        bucket(60),
        bucket(80, 20, "2025-05-09T21:59:59.999Z", sleepEnd),
        bucket(80, 20, sleepStart, "2025-05-10T06:00:00.001Z"),
        bucket(80, 20, "synthetic-invalid", sleepEnd),
        bucket(80, 20, sleepStart, "synthetic-invalid"),
        bucket(80, 0),
      ],
    }),
  ]);
});
test("keeps multiple sleep intervals on their wake day across timezone boundaries", () => {
  const sessions = [
    session("2025-05-09T18:00:00Z", "2025-05-10T02:00:00Z"),
    session("2025-05-10T10:00:00Z", "2025-05-10T11:00:00Z"),
  ];
  compare(
    [
      fact({
        hourly: [
          bucket(60, 20, sessions[0].start, sessions[0].end),
          bucket(80, 20, sessions[1].start, sessions[1].end),
          bucket(99, 20, "2025-05-10T01:00:00Z", "2025-05-10T10:30:00Z"),
        ],
      }),
    ],
    sessions,
    "Asia/Kolkata",
  );
});
test("missing and insufficient hourly samples stay missing; partial context remains conservative", () => {
  compare([fact({ hourly: [] })]);
  compare([fact({ hourly: [bucket(60, 19)] })]);
  const result = compare(
    [fact({ hourly: [bucket()] })],
    [session()],
    "UTC",
    true,
  );
  expect(result.partial).toBe(true);
  expect(result.readiness.score).toBeNull();
});

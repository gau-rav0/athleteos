import { expect, test } from "vitest";
import { cursorEpochMicroseconds, decodeCompactPage } from "@/lib/data/compact";
const identity = "00000000-0000-4000-8000-000000000010";
const record = {
  id: identity,
  kind: "steps",
  provider: "health_connect",
  origin: "live",
  source: "synthetic.example",
  channel: "synthetic-watch",
  rank: 300,
  start: "2025-01-01T00:00:00Z",
  end: "2025-01-01T01:00:00Z",
  received: "2025-01-02T00:00:00Z",
  value: 100,
  samples: 1,
  supported: true,
};
const envelope = (records: unknown[]) => ({
  wire_version: 1,
  records,
  has_more: false,
  next_start: null,
  next_id: null,
});
test("restores only omitted null/defaultempty fields without changing identity or provenance", () => {
  const page = decodeCompactPage(envelope([record]));
  expect(page.invalid).toBe(0);
  expect(page.facts[0]).toMatchObject({
    ...record,
    min: null,
    max: null,
    bodyFat: null,
    sessions: [],
    hourly: [],
  });
});
test("required source fields, malformed originals and invalid explicit arrays remain quarantined", () => {
  const { source: omitted, ...missingSource } = record;
  void omitted;
  const page = decodeCompactPage(
    envelope([
      missingSource,
      { transport_invalid: true },
      { ...record, sessions: null },
      { ...record, value: Infinity },
    ]),
  );
  expect(page.facts).toEqual([]);
  expect(page.invalid).toBe(4);
  expect(page.records).toBe(4);
});
test("a short byte-limited page stays incomplete and uses the supplied canonical cursor", () => {
  const page = decodeCompactPage({
    ...envelope([record]),
    has_more: true,
    next_start: record.start,
    next_id: identity,
  });
  expect(page.hasMore).toBe(true);
  expect(page.nextId).toBe(identity);
  expect(page.nextStart).toBe(record.start);
});

test("explicit zero, false and nested measurements are preserved exactly", () => {
  const original = {
    ...record,
    value: 0,
    samples: 0,
    min: 0,
    max: 0,
    bodyFat: 0,
    supported: false,
    sessions: [
      {
        start: record.start,
        end: record.end,
        minutes: 60,
        stages: { awake: 0, deep: 60 },
        durationBasis: "known_stages",
        category: "synthetic",
      },
    ],
    hourly: [{ start: record.start, end: record.end, mean: 0, count: 0 }],
  };
  const page = decodeCompactPage(envelope([original]));
  expect(page.invalid).toBe(0);
  expect(page.facts).toEqual([original]);
});
test("unknown versions, missing continuation and oversized row counts fail closed", () => {
  expect(() =>
    decodeCompactPage({ ...envelope([]), wire_version: 3 }),
  ).toThrow();
  expect(() =>
    decodeCompactPage({ ...envelope([record]), has_more: true }),
  ).toThrow();
  expect(() =>
    decodeCompactPage({ ...envelope([]), records: Array(4001).fill(record) }),
  ).toThrow();
});

test("cursor precision is exact to six fractional digits with equivalent offsets", () => {
  const before = cursorEpochMicroseconds("2025-01-01T00:00:00.000002Z")!;
  expect(before - cursorEpochMicroseconds("2025-01-01T00:00:00.000001Z")!).toBe(
    BigInt(1),
  );
  expect(cursorEpochMicroseconds("2025-01-01T01:00:00.000002+01:00")).toBe(
    before,
  );
  expect(cursorEpochMicroseconds("2025-01-01T00:00:00.1Z")).toBe(
    cursorEpochMicroseconds("2025-01-01T00:00:00.100000Z"),
  );
  expect(cursorEpochMicroseconds("2025-01-01T00:00:00.0000001Z")).toBeNull();
  expect(cursorEpochMicroseconds("2025-01-01")).toBeNull();
});

test("optional SQL timing is finite and cannot invalidate or change valid records", () => {
  const base = decodeCompactPage(envelope([record]));
  expect(base.sqlMs).toBeNull();
  for (const value of [0, 2.5]) {
    const timed = decodeCompactPage({ ...envelope([record]), sql_ms: value });
    expect(timed.sqlMs).toBe(value);
    expect(timed.facts).toEqual(base.facts);
  }
  for (const value of [-1, Infinity, NaN, "1", null, {}]) {
    const timed = decodeCompactPage({ ...envelope([record]), sql_ms: value });
    expect(timed.sqlMs).toBeNull();
    expect(timed.facts).toEqual(base.facts);
    expect(timed.invalid).toBe(0);
  }
});

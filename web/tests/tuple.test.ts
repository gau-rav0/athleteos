import { expect, test } from "vitest";
import { decodeCompactPage, TUPLE_FACT_FIELDS } from "@/lib/data/compact";
import type { Fact } from "@/lib/data/schema";
const fact: Fact = {
  id: "00000000-0000-4000-8000-000000000010",
  kind: "heart_rate",
  provider: "health_connect",
  origin: "historical",
  source: "synthetic.example",
  channel: "synthetic-watch",
  rank: 0,
  start: "2025-01-01T00:00:00.000001Z",
  end: null,
  received: "2025-01-02T00:00:00Z",
  value: 0,
  samples: 0,
  min: 0,
  max: null,
  sessions: [],
  hourly: [
    {
      start: "2025-01-01T00:00:00Z",
      end: "2025-01-01T01:00:00Z",
      mean: 0,
      count: 0,
    },
  ],
  supported: false,
  bodyFat: null,
};
const tuple = TUPLE_FACT_FIELDS.map((key) => fact[key]);
const envelope = (records: unknown[]) => ({
  wire_version: 2,
  records,
  has_more: false,
  next_start: null,
  next_id: null,
});
test("all 18 positions preserve provenance, zero, false, null and nested arrays without defaults", () => {
  const page = decodeCompactPage(envelope([tuple]));
  expect(page.invalid).toBe(0);
  expect(page.facts).toEqual([fact]);
  expect(TUPLE_FACT_FIELDS).toHaveLength(18);
});
test("malformed tuple lengths/types and missing provenance remain quarantined", () => {
  const missingSource = [...tuple];
  missingSource[4] = null;
  const wrongProvider = [...tuple];
  wrongProvider[2] = "synthetic-unknown-provider";
  const page = decodeCompactPage(
    envelope([
      tuple.slice(0, 17),
      [...tuple, null],
      missingSource,
      wrongProvider,
      { transport_invalid: true },
      null,
      1,
    ]),
  );
  expect(page.invalid).toBe(7);
  expect(page.records).toBe(7);
  expect(page.facts).toEqual([]);
});
test("ordinary object records cannot be interpreted as v1 inside a v2 envelope", () => {
  expect(() => decodeCompactPage(envelope([tuple, fact]))).toThrow(
    "INVALID_TUPLE_RECORD",
  );
});
test("version-specific row caps, unknown versions and continuation metadata fail closed", () => {
  const records = Array(8000).fill({ transport_invalid: true });
  expect(decodeCompactPage(envelope(records)).invalid).toBe(8000);
  expect(() =>
    decodeCompactPage(envelope([...records, { transport_invalid: true }])),
  ).toThrow();
  expect(() =>
    decodeCompactPage({ ...envelope(records), wire_version: 1 }),
  ).toThrow();
  expect(() =>
    decodeCompactPage({ ...envelope([]), wire_version: 3 }),
  ).toThrow();
  expect(() =>
    decodeCompactPage({ ...envelope([tuple]), has_more: true }),
  ).toThrow();
});
test("a byte-short v2 page has explicit canonical continuation independent of tuple identity", () => {
  const page = decodeCompactPage({
    ...envelope([tuple, { transport_invalid: true }]),
    has_more: true,
    next_start: fact.start,
    next_id: fact.id,
  });
  expect(page.hasMore).toBe(true);
  expect(page.records).toBe(2);
  expect(page.invalid).toBe(1);
  expect(page.nextId).toBe(fact.id);
});

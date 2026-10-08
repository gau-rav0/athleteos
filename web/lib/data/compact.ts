import { z } from "zod";
import { factSchema, type Fact } from "./schema";
export const TUPLE_FACT_FIELDS = [
  "id",
  "kind",
  "provider",
  "origin",
  "source",
  "channel",
  "rank",
  "start",
  "end",
  "received",
  "value",
  "samples",
  "min",
  "max",
  "sessions",
  "hourly",
  "supported",
  "bodyFat",
] as const;
// PostgreSQL keysets retain microseconds; Date.parse alone truncates them and
// can incorrectly compare distinct records as equal millisecond timestamps.
export function cursorEpochMicroseconds(value: string): bigint | null {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return null;
  const milliseconds = Date.parse(match[1] + match[3]);
  if (!Number.isFinite(milliseconds)) return null;
  return (
    BigInt(milliseconds) * BigInt(1000) +
    BigInt((match[2] ?? "").padEnd(6, "0"))
  );
}
const cursorInstant = z
  .string()
  .refine((value) => cursorEpochMicroseconds(value) !== null, "INVALID_CURSOR");
const envelopeSchema = z
  .object({
    wire_version: z.union([z.literal(1), z.literal(2)]),
    // Optional diagnostics never invalidate otherwise valid health records.
    sql_ms: z.unknown().optional(),
    records: z.array(z.unknown()).max(8000),
    has_more: z.boolean(),
    next_start: cursorInstant.nullable(),
    next_id: z.uuid().nullable(),
  })
  .refine(
    (page) => page.wire_version !== 1 || page.records.length <= 4000,
    "INVALID_ROW_LIMIT",
  )
  .refine(
    (page) =>
      page.has_more
        ? page.records.length > 0 &&
          page.next_start !== null &&
          page.next_id !== null
        : page.next_start === null && page.next_id === null,
    "INVALID_CONTINUATION",
  );
export type CompactPage = {
  facts: Fact[];
  invalid: number;
  records: number;
  hasMore: boolean;
  nextStart: string | null;
  nextId: string | null;
  sqlMs: number | null;
};

// Version-gated restoration only: required provenance/identity/timestamp fields
// have no defaults. Invalid originals remain quarantined, not repaired silently.
export function decodeCompactPage(input: unknown): CompactPage {
  const page = envelopeSchema.parse(input);
  const facts: Fact[] = [];
  let invalid = 0;
  for (const record of page.records) {
    if (page.wire_version === 2) {
      if (record && typeof record === "object" && !Array.isArray(record)) {
        if (
          "transport_invalid" in record &&
          record.transport_invalid === true
        ) {
          invalid++;
          continue;
        }
        throw new Error("INVALID_TUPLE_RECORD");
      }
      if (
        !Array.isArray(record) ||
        record.length !== TUPLE_FACT_FIELDS.length
      ) {
        invalid++;
        continue;
      }
      const parsed = factSchema.safeParse(
        Object.fromEntries(
          TUPLE_FACT_FIELDS.map((key, index) => [key, record[index]]),
        ),
      );
      if (parsed.success) facts.push(parsed.data);
      else invalid++;
      continue;
    }
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      ("transport_invalid" in record && record.transport_invalid === true)
    ) {
      invalid++;
      continue;
    }
    const result = factSchema.safeParse({
      end: null,
      value: null,
      min: null,
      max: null,
      bodyFat: null,
      sessions: [],
      hourly: [],
      ...record,
    });
    if (result.success) facts.push(result.data);
    else invalid++;
  }
  const sqlTiming = z.number().min(0).safeParse(page.sql_ms);
  return {
    sqlMs: sqlTiming.success ? sqlTiming.data : null,
    facts,
    invalid,
    records: page.records.length,
    hasMore: page.has_more,
    nextStart: page.next_start,
    nextId: page.next_id,
  };
}

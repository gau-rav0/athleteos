import { z } from "zod";
import { factSchema, type Fact } from "./schema";
const cursorInstant = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), "INVALID_CURSOR");
const envelopeSchema = z
  .object({
    wire_version: z.literal(1),
    records: z.array(z.unknown()).max(4000),
    has_more: z.boolean(),
    next_start: cursorInstant.nullable(),
    next_id: z.uuid().nullable(),
  })
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
};

// Version-gated restoration only: required provenance/identity/timestamp fields
// have no defaults. Invalid originals remain quarantined, not repaired silently.
export function decodeCompactPage(input: unknown): CompactPage {
  const page = envelopeSchema.parse(input);
  const facts: Fact[] = [];
  let invalid = 0;
  for (const record of page.records) {
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
  return {
    facts,
    invalid,
    records: page.records.length,
    hasMore: page.has_more,
    nextStart: page.next_start,
    nextId: page.next_id,
  };
}

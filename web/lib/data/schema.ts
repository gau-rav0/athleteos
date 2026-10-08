import { z } from "zod";
const number = z.number().finite();
const instant = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), "INVALID_TIMESTAMP");
export const sessionSchema = z.object({
  start: instant,
  end: instant,
  minutes: number.nonnegative(),
  stages: z.record(z.string(), number.nonnegative()),
  durationBasis: z.enum(["known_stages", "vendor_duration", "interval"]),
  category: z.string().max(128),
});
export const factSchema = z.object({
  id: z.string(),
  kind: z.string(),
  provider: z.enum(["samsung_health", "health_connect"]),
  origin: z.enum(["live", "historical"]),
  source: z.string(),
  channel: z.string(),
  rank: number,
  start: instant,
  end: instant.nullable(),
  received: instant,
  value: number.nullable(),
  samples: number.nonnegative(),
  min: number.nullable(),
  max: number.nullable(),
  sessions: z.array(sessionSchema).max(1000),
  hourly: z
    .array(
      z.object({
        start: instant,
        end: instant,
        mean: number,
        count: number.nonnegative(),
      }),
    )
    .max(1000),
  supported: z.boolean(),
  bodyFat: number.nullable(),
});
export type Fact = z.infer<typeof factSchema>;
export type Session = z.infer<typeof sessionSchema> & {
  provider: Fact["provider"];
  source: string;
  day: string;
};
export const inventorySchema = z.object({
  inventory: z.array(
    z.object({
      provider: z.string(),
      record_type: z.string(),
      records: number,
      observed_days: number,
      first_at: instant.nullable(),
      last_at: instant.nullable(),
      received_at: instant,
      historical_records: number,
    }),
  ),
  sync: z
    .object({
      status: z.string(),
      finished: instant.nullable(),
      failures: number,
      sources: z.record(z.string(), z.string()),
    })
    .nullable(),
});
export type Inventory = z.infer<typeof inventorySchema>;
export const snapshotMetadataSchema = z
  .object({
    as_of: instant.nullable(),
    stale: z.boolean(),
    available: z.boolean(),
    refresh_required: z.boolean(),
  })
  .refine((snapshot) => !snapshot.available || snapshot.as_of !== null);
export type InventorySnapshot = z.infer<typeof snapshotMetadataSchema>;
export const inventorySnapshotSchema = inventorySchema.extend({
  snapshot: snapshotMetadataSchema,
});
export const dashboardQuery = z.object({
  days: z.coerce
    .number()
    .refine((value) => [7, 28, 90, 180, 365, 730].includes(value)),
  timezone: z
    .string()
    .max(64)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
});

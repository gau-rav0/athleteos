import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { dashboardQuery } from "./schema";
import { addDays, localDay, midnight } from "@/lib/analytics/time";
import { MIN_ANALYTICS_HISTORY_DAYS } from "@/lib/analytics/history";

export const projectionStatusSchema = z.object({ remaining: z.boolean() });
export function rpcSignal(milliseconds: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
const workerResult = z.object({
  processed: z.number().int().min(0).max(50),
  scanned: z.number().int().min(0).max(2000),
  remaining: z.boolean(),
  busy: z.boolean(),
});

// Call only after independently validating Auth and mutation Origin in the POST
// handler. Caller JWT/RLS applies; no user id, raw body or service key is accepted.
export async function advanceProjection(
  client: SupabaseClient,
  days: number,
  timezone: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  dashboardQuery.parse({ days, timezone });
  const today = localDay(new Date(), timezone);
  const { data, error } = await client
    .rpc("advance_web_projection", {
      p_from: new Date(
        midnight(
          addDays(today, -Math.max(days, MIN_ANALYTICS_HISTORY_DAYS) - 1),
          timezone,
        ),
      ).toISOString(),
      p_until: new Date(midnight(addDays(today, 1), timezone)).toISOString(),
      p_limit: 25,
    })
    .abortSignal(rpcSignal(12000, signal));
  if (error) throw new Error("PROJECTION_WORK_UNAVAILABLE");
  return workerResult.parse(data);
}

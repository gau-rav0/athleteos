import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { snapshotMetadataSchema, dashboardQuery } from "./schema";
import { rpcSignal } from "./projection";
const inventoryWorkerResult = z.object({
  refreshed: z.boolean(),
  busy: z.boolean(),
  snapshot: snapshotMetadataSchema,
});

// Auth and exact Origin must be independently checked by the POST handler.
// This metadata-only worker never imports data or operates the phone queue.
export async function refreshInventory(
  client: SupabaseClient,
  timezone: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  dashboardQuery.shape.timezone.parse(timezone);
  const { data, error } = await client
    .rpc("refresh_web_inventory_snapshot", { p_timezone: timezone })
    .abortSignal(rpcSignal(12000, signal));
  if (error) throw new Error("INVENTORY_WORK_UNAVAILABLE");
  return inventoryWorkerResult.parse(data);
}

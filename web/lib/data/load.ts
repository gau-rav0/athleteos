import "server-only";
import type {
  SupabaseClient,
  PostgrestSingleResponse,
} from "@supabase/supabase-js";
import { factSchema, inventorySchema, type Fact } from "./schema";
import { buildDataset } from "@/lib/analytics/engine";
import { addDays, localDay, midnight } from "@/lib/analytics/time";
import { projectionStatusSchema } from "./projection";

function rpcFailure(stage: string, code?: string) {
  // Static stages and SQLSTATE only: never log messages, requests or payloads.
  console.warn("DASHBOARD_RPC_FAILURE", {
    stage,
    code: code && /^[A-Z0-9]{5,12}$/.test(code) ? code : "UNAVAILABLE",
  });
}

export async function loadDashboard(
  client: SupabaseClient,
  days: number,
  timezone: string,
) {
  const started = performance.now(),
    now = new Date(),
    today = localDay(now, timezone),
    from = new Date(
      midnight(addDays(today, -Math.max(days, 90) - 1), timezone),
    ).toISOString(),
    until = new Date(midnight(addDays(today, 1), timezone)).toISOString();
  // This serving path is read-only: projection work belongs to a separate POST.
  // Status is an indexed checkpoint/watermark check, not a broad candidate scan.
  let queries = 2;
  const [status, inventoryResult] = await Promise.all([
    client
      .rpc("web_projection_status", { p_from: from, p_until: until })
      .abortSignal(AbortSignal.timeout(8000)),
    client
      .rpc("web_inventory", { p_timezone: timezone })
      .abortSignal(AbortSignal.timeout(8000)),
  ]);
  const parsedStatus = projectionStatusSchema.safeParse(status.data);
  let remaining =
    status.error !== null ||
    !parsedStatus.success ||
    parsedStatus.data.remaining;
  if (status.error) rpcFailure("status", status.error.code);
  // A metadata-query failure must not take valid charts down with it. Empty
  // inventory here means unavailable metadata, never proof of zero raw records.
  const parsedInventory = inventorySchema.safeParse(inventoryResult.data);
  if (inventoryResult.error || !parsedInventory.success) {
    remaining = true;
    rpcFailure("inventory", inventoryResult.error?.code);
  }
  const facts: Fact[] = [];
  let invalid = 0,
    finished = false,
    beforeStart: string | null = null,
    beforeId: string | null = null;
  const readDeadline = performance.now() + 14000;
  for (
    let count = 0;
    count < 100000 && !finished && performance.now() < readDeadline;
    count += 2000
  ) {
    queries++;
    const page: PostgrestSingleResponse<unknown> = await client
      .rpc("web_facts_cursor", {
        p_from: from,
        p_until: until,
        p_before_start: beforeStart,
        p_before_id: beforeId,
        p_limit: 2000,
      })
      .abortSignal(AbortSignal.timeout(8000));
    if (page.error || !Array.isArray(page.data)) {
      rpcFailure("page", page.error?.code);
      // After at least one valid page, retain its partial snapshot. An initial
      // page failure is a true unavailable response, not an empty health day.
      if (count === 0) throw new Error("DATA_READ_UNAVAILABLE");
      break;
    }
    if (page.data.length < 2000) finished = true;
    for (const row of page.data) {
      const parsed = factSchema.safeParse(row);
      if (parsed.success) facts.push(parsed.data);
      else invalid++;
    }
    if (!finished) {
      const last: { start?: unknown; id?: unknown } | null | undefined =
        page.data.at(-1);
      if (
        !last ||
        typeof last.start !== "string" ||
        typeof last.id !== "string" ||
        !Number.isFinite(Date.parse(last.start)) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          last.id,
        ) ||
        (last.start === beforeStart && last.id === beforeId)
      ) {
        invalid++;
        break;
      }
      beforeStart = last.start;
      beforeId = last.id;
    }
  }
  const inventory =
      parsedInventory.success && !inventoryResult.error
        ? parsedInventory.data
        : { inventory: [], sync: null },
    result = buildDataset(facts, inventory, {
      days,
      timezone,
      now,
      partial: remaining || !finished || invalid > 0,
      invalidFacts: invalid,
    });
  result.queryCount = queries;
  result.inventoryAvailable = parsedInventory.success && !inventoryResult.error;
  result.queryMs = Math.round(performance.now() - started);
  return result;
}

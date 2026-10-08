import "server-only";
import type {
  SupabaseClient,
  PostgrestSingleResponse,
} from "@supabase/supabase-js";
import { factSchema, inventorySnapshotSchema, type Fact } from "./schema";
import { buildDataset } from "@/lib/analytics/engine";
import { addDays, localDay, midnight } from "@/lib/analytics/time";
import { projectionStatusSchema, rpcSignal } from "./projection";

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
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
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
  const metadataStarted = performance.now();
  let statusMs = 0,
    inventoryMs = 0,
    pageMs = 0;
  // Start metadata concurrently with fact pages. A slow coverage aggregation
  // must not add another full network round trip before read serving begins.
  const metadataPromise = Promise.allSettled([
    Promise.resolve(
      client
        .rpc("web_projection_status", { p_from: from, p_until: until })
        .abortSignal(rpcSignal(8000, signal)),
    ).finally(() => {
      statusMs = performance.now() - metadataStarted;
    }),
    Promise.resolve(
      client
        .rpc("read_web_inventory_snapshot", { p_timezone: timezone })
        .abortSignal(rpcSignal(8000, signal)),
    ).finally(() => {
      inventoryMs = performance.now() - metadataStarted;
    }),
  ]);
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
    signal?.throwIfAborted();
    queries++;
    const pageStarted = performance.now();
    const page: PostgrestSingleResponse<unknown> = await client
      .rpc("web_facts_cursor", {
        p_from: from,
        p_until: until,
        p_before_start: beforeStart,
        p_before_id: beforeId,
        p_limit: 2000,
      })
      .abortSignal(rpcSignal(8000, signal));
    pageMs += performance.now() - pageStarted;
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
  const metadata = await metadataPromise;
  const unavailable = { data: null, error: { code: "UNAVAILABLE" } };
  const status =
    metadata[0].status === "fulfilled" ? metadata[0].value : unavailable;
  const inventoryResult =
    metadata[1].status === "fulfilled" ? metadata[1].value : unavailable;
  const parsedStatus = projectionStatusSchema.safeParse(status.data);
  const remaining =
    status.error !== null ||
    !parsedStatus.success ||
    parsedStatus.data.remaining;
  if (status.error) rpcFailure("status", status.error.code);
  // Missing metadata means unavailable inventory, never zero uploaded records.
  const parsedInventory = inventorySnapshotSchema.safeParse(
    inventoryResult.data,
  );
  if (inventoryResult.error || !parsedInventory.success) {
    rpcFailure("inventory", inventoryResult.error?.code);
  }
  const analyticsStarted = performance.now();
  signal?.throwIfAborted();
  const inventory =
      parsedInventory.success && !inventoryResult.error
        ? {
            inventory: parsedInventory.data.inventory,
            sync: parsedInventory.data.sync,
          }
        : { inventory: [], sync: null },
    result = buildDataset(facts, inventory, {
      days,
      timezone,
      now,
      partial: remaining || !finished || invalid > 0,
      invalidFacts: invalid,
    });
  result.queryCount = queries;
  result.inventoryAvailable =
    parsedInventory.success &&
    !inventoryResult.error &&
    parsedInventory.data.snapshot.available;
  result.inventorySnapshot =
    parsedInventory.success && !inventoryResult.error
      ? parsedInventory.data.snapshot
      : { as_of: null, stale: true, available: false, refresh_required: true };
  result.queryMs = Math.round(performance.now() - started);
  // Performance-only counters: no values, identities, row payloads or tokens.
  return Object.assign(result, {
    timings: {
      rpcMs: Math.round(Math.max(statusMs, inventoryMs, pageMs)),
      analyticsMs: Math.round(performance.now() - analyticsStarted),
      statusMs: Math.round(statusMs),
      inventoryMs: Math.round(inventoryMs),
      pageMs: Math.round(pageMs),
    },
  });
}

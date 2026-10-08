import "server-only";
import type {
  SupabaseClient,
  PostgrestSingleResponse,
} from "@supabase/supabase-js";
import { inventorySnapshotSchema, type Fact } from "./schema";
import {
  cursorEpochMicroseconds,
  decodeCompactPage,
  type CompactPage,
} from "./compact";
import { buildDataset, type PartialReason } from "@/lib/analytics/engine";
import { MIN_ANALYTICS_HISTORY_DAYS } from "@/lib/analytics/history";
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
      midnight(
        addDays(today, -Math.max(days, MIN_ANALYTICS_HISTORY_DAYS) - 1),
        timezone,
      ),
    ).toISOString(),
    until = new Date(midnight(addDays(today, 1), timezone)).toISOString();
  // This serving path is read-only: projection work belongs to a separate POST.
  // Status is an indexed checkpoint/watermark check, not a broad candidate scan.
  let queries = 2;
  const metadataStarted = performance.now();
  let statusMs = 0,
    inventoryMs = 0,
    pageMs = 0,
    successfulPageMs = 0,
    failedPageMs = 0,
    decodeMs = 0,
    sqlMs = 0,
    timedPages = 0,
    untimedPages = 0,
    sqlTimingAvailable = true;
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
  let recordsRead = 0;
  while (
    recordsRead < 100000 &&
    !finished &&
    performance.now() < readDeadline
  ) {
    signal?.throwIfAborted();
    const pageStarted = performance.now();
    const remainingReadMs = readDeadline - pageStarted;
    if (remainingReadMs <= 0) break;
    // A late page gets only the remaining serving budget, rather than another
    // full eight seconds. AbortSignal.timeout requires positive integer ms.
    const pageTimeoutMs = Math.max(
      1,
      Math.min(8000, Math.floor(remainingReadMs)),
    );
    queries++;
    const page: PostgrestSingleResponse<unknown> = await client
      .rpc("web_tuple_facts_cursor", {
        p_from: from,
        p_until: until,
        p_before_start: beforeStart,
        p_before_id: beforeId,
        p_limit: Math.min(8000, 100000 - recordsRead),
      })
      .abortSignal(rpcSignal(pageTimeoutMs, signal));
    const pageElapsed = performance.now() - pageStarted;
    pageMs += pageElapsed;
    const decodeStarted = performance.now();
    let decoded: CompactPage | undefined;
    if (!page.error) {
      try {
        decoded = decodeCompactPage(page.data);
        // Compare canonical SQL keysets, independent of malformed fact fields.
        // A duplicate or increasing cursor cannot safely prove continuation.
        if (
          decoded.hasMore &&
          beforeStart !== null &&
          beforeId !== null &&
          !(
            cursorEpochMicroseconds(decoded.nextStart!)! <
              cursorEpochMicroseconds(beforeStart)! ||
            (cursorEpochMicroseconds(decoded.nextStart!) ===
              cursorEpochMicroseconds(beforeStart) &&
              decoded.nextId!.toLowerCase() < beforeId.toLowerCase())
          )
        )
          decoded = undefined;
        if (decoded && decoded.records > Math.min(8000, 100000 - recordsRead))
          decoded = undefined;
      } catch {
        // Malformed envelopes fail closed, with no payload in diagnostics.
      }
    }
    decodeMs += performance.now() - decodeStarted;
    if (page.error || !decoded) {
      sqlTimingAvailable = false;
      untimedPages++;
      failedPageMs += pageElapsed;
      rpcFailure("page", page.error?.code);
      // After at least one valid page, retain its partial snapshot. An initial
      // page failure is a true unavailable response, not an empty health day.
      if (recordsRead === 0) throw new Error("DATA_READ_UNAVAILABLE");
      break;
    }
    successfulPageMs += pageElapsed;
    if (decoded.sqlMs === null) {
      sqlTimingAvailable = false;
      untimedPages++;
    } else {
      sqlMs += decoded.sqlMs;
      timedPages++;
    }
    recordsRead += decoded.records;
    finished = !decoded.hasMore;
    facts.push(...decoded.facts);
    invalid += decoded.invalid;
    beforeStart = decoded.nextStart;
    beforeId = decoded.nextId;
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
  const partialReasons: PartialReason[] = [];
  if (status.error !== null || !parsedStatus.success)
    partialReasons.push("PROJECTION_STATUS_UNAVAILABLE");
  else if (remaining) partialReasons.push("PROJECTION_PENDING");
  if (!finished) partialReasons.push("READ_INCOMPLETE");
  if (invalid > 0) partialReasons.push("INVALID_SUMMARIES");
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
    // Work scheduling and displayed completeness have different meanings.
    // Keep partial as the conservative analytics gate, including read failure.
    projectionPending: remaining,
    readIncomplete: !finished,
    partialReasons,
    timings: {
      rpcMs: Math.round(Math.max(statusMs, inventoryMs, pageMs)),
      analyticsMs: Math.round(performance.now() - analyticsStarted),
      statusMs: Math.round(statusMs),
      inventoryMs: Math.round(inventoryMs),
      pageMs: Math.round(pageMs),
      successfulPageMs: Math.round(successfulPageMs),
      failedPageMs: Math.round(failedPageMs),
      decodeMs: Math.round(decodeMs),
      sqlMs: sqlTimingAvailable && timedPages > 0 ? Math.round(sqlMs) : null,
      sqlKnownMs: Math.round(sqlMs),
      timedPages,
      untimedPages,
    },
  });
}

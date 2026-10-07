import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { factSchema, inventorySchema, type Fact } from "./schema";
import { buildDataset } from "@/lib/analytics/engine";
import { addDays, localDay, midnight } from "@/lib/analytics/time";

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
  let queries = 0,
    remaining = false;
  for (let i = 0; i < 2; i++) {
    queries++;
    const { data, error } = await client.rpc("refresh_web_facts", {
      p_from: from,
      p_until: until,
      p_limit: 1000,
    });
    if (error) throw new Error("DATA_SUMMARIES_UNAVAILABLE");
    remaining = Boolean(data?.remaining);
    if (!remaining) break;
  }
  const facts: Fact[] = [];
  let invalid = 0,
    finished = false;
  for (let offset = 0; offset < 100000 && !finished; offset += 5000) {
    const pages = await Promise.all(
      Array.from({ length: 5 }, (_, i) => {
        queries++;
        return client.rpc("web_facts_page", {
          p_from: from,
          p_until: until,
          p_offset: offset + i * 1000,
        });
      }),
    );
    for (const page of pages) {
      if (page.error || !Array.isArray(page.data))
        throw new Error("DATA_READ_UNAVAILABLE");
      if (page.data.length < 1000) finished = true;
      for (const row of page.data) {
        const parsed = factSchema.safeParse(row);
        if (parsed.success) facts.push(parsed.data);
        else invalid++;
      }
    }
  }
  queries++;
  const inventoryResult = await client.rpc("web_inventory", {
    p_timezone: timezone,
  });
  if (inventoryResult.error) throw new Error("DATA_INVENTORY_UNAVAILABLE");
  const inventory = inventorySchema.parse(inventoryResult.data),
    result = buildDataset(facts, inventory, {
      days,
      timezone,
      now,
      partial: remaining || !finished || invalid > 0,
      invalidFacts: invalid,
    });
  result.queryCount = queries;
  result.queryMs = Math.round(performance.now() - started);
  return result;
}

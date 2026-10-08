import { afterEach, expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { loadDashboard } from "@/lib/data/load";

afterEach(() => vi.restoreAllMocks());

function source(errors: (string | null)[]) {
  const limits: number[] = [];
  const rpc = vi.fn(async (name: string, args: { p_limit?: number }) => {
    if (name === "refresh_web_facts") {
      limits.push(args.p_limit!);
      const code = errors.shift();
      return code
        ? {
            data: null,
            error: { code, message: "private payload must never be logged" },
          }
        : { data: { processed: 0, remaining: false }, error: null };
    }
    return {
      data: name === "web_inventory" ? { inventory: [], sync: null } : [],
      error: null,
    };
  });
  return { client: { rpc } as unknown as SupabaseClient, limits, rpc };
}

test("cancelled refresh retries a smaller transaction before serving completed facts", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const fake = source(["57014", null]);
  const result = await loadDashboard(fake.client, 7, "UTC");
  expect(fake.limits).toEqual([100, 25]);
  expect(result.partial).toBe(false);
  expect(result.queryCount).toBe(8);
});

test("repeated timeouts serve cached facts as partial and withhold scores", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const fake = source(["57014", "57014"]);
  const result = await loadDashboard(fake.client, 7, "UTC");
  expect(result.partial).toBe(true);
  expect(result.readiness.score).toBeNull();
  expect(result.days.every((d) => d.steps === null)).toBe(true);
  expect(JSON.stringify(warn.mock.calls)).not.toContain("private payload");
});

test("permission errors remain failures rather than successful partial refreshes", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const fake = source(["42501"]);
  await expect(loadDashboard(fake.client, 7, "UTC")).rejects.toThrow(
    "DATA_SUMMARIES_UNAVAILABLE",
  );
  expect(fake.limits).toEqual([100]);
});

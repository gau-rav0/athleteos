import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuthRetryableFetchError } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  worker: vi.fn(),
  client: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: mocks.client }));
vi.mock("@/lib/data/inventory", () => ({ refreshInventory: mocks.worker }));
import { POST } from "@/app/api/dashboard/inventory/route";

function request(
  body: unknown = { timezone: "UTC" },
  origin = "http://localhost:3100",
) {
  return new Request("http://localhost:3100/api/dashboard/inventory", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "http://localhost:3100");
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.auth } });
  mocks.auth.mockResolvedValue({
    data: { user: { id: "synthetic-owner" } },
    error: null,
  });
  mocks.worker.mockResolvedValue({
    refreshed: true,
    busy: false,
    snapshot: {
      as_of: "2025-01-01T00:00:00Z",
      stale: false,
      available: true,
      refresh_required: false,
    },
  });
});
afterEach(() => vi.unstubAllEnvs());

test("coverage mutations require exact Origin and reject forged owner/TTL/body input", async () => {
  for (const origin of ["", "https://synthetic-attacker.example"])
    expect((await POST(request(undefined, origin))).status).toBe(403);
  for (const body of [
    { timezone: "UTC", user_id: "synthetic-other" },
    { timezone: "UTC", ttl: 0 },
    { timezone: "UTC", days: 28 },
    { timezone: "Invalid/Zone" },
  ])
    expect((await POST(request(body))).status).toBe(400);
  expect((await POST(request({ timezone: "x".repeat(5000) }))).status).toBe(
    413,
  );
  const plain = request();
  plain.headers.set("Content-Type", "text/plain");
  expect((await POST(plain)).status).toBe(415);
  expect(mocks.client).not.toHaveBeenCalled();
});

test("anonymous callers cannot refresh private coverage and Auth outages do not sign users out", async () => {
  mocks.auth.mockResolvedValue({ data: { user: null }, error: null });
  expect((await POST(request())).status).toBe(401);
  mocks.auth.mockResolvedValue({
    data: { user: null },
    error: new AuthRetryableFetchError("synthetic private error", 0),
  });
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "AUTH_SERVICE_UNAVAILABLE" });
  expect(mocks.worker).not.toHaveBeenCalled();
});

test("validated caller receives only snapshot progress with private headers and cancellation", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(await mocks.worker.mock.results[0].value);
  expect(mocks.worker).toHaveBeenCalledWith(
    await mocks.client.mock.results[0].value,
    "UTC",
    expect.any(AbortSignal),
  );
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("Vary")).toBe("Cookie");
});

test("coverage failure does not expose database details", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.worker.mockRejectedValue(
    new Error("synthetic private database detail"),
  );
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "INVENTORY_REFRESH_UNAVAILABLE",
  });
  expect(JSON.stringify(warn.mock.calls)).not.toContain("private database");
  warn.mockRestore();
});

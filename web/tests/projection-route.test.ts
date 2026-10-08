import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  worker: vi.fn(),
  client: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: mocks.client }));
vi.mock("@/lib/data/projection", () => ({ advanceProjection: mocks.worker }));
import { POST } from "@/app/api/dashboard/projection/route";

function request(
  body: unknown = { days: 7, timezone: "UTC" },
  origin = "http://localhost:3100",
) {
  return new Request("http://localhost:3100/api/dashboard/projection", {
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
    processed: 25,
    scanned: 25,
    remaining: true,
    busy: false,
  });
});

test("missing/foreign Origin rejects before Auth or projection work", async () => {
  for (const origin of ["", "https://synthetic-attacker.example"]) {
    const response = await POST(request(undefined, origin));
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  }
  expect(mocks.client).not.toHaveBeenCalled();
});

test("strict body rejects owner injection, invalid ranges, malformed and oversized input", async () => {
  for (const body of [
    { days: 7, timezone: "UTC", user_id: "synthetic-other" },
    { days: 999, timezone: "UTC" },
    { days: 7, timezone: "Invalid/Zone" },
  ]) {
    expect((await POST(request(body))).status).toBe(400);
  }
  const malformed = request();
  expect(
    (
      await POST(
        new Request(malformed.url, {
          method: "POST",
          headers: malformed.headers,
          body: "{",
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (await POST(request({ days: 7, timezone: "x".repeat(5000) }))).status,
  ).toBe(413);
  expect(mocks.client).not.toHaveBeenCalled();
});

test("JSON content type required and anonymous caller cannot run worker", async () => {
  const plain = request();
  plain.headers.set("Content-Type", "text/plain");
  expect((await POST(plain)).status).toBe(415);
  mocks.auth.mockResolvedValue({ data: { user: null }, error: null });
  const response = await POST(request());
  expect(response.status).toBe(401);
  expect(mocks.worker).not.toHaveBeenCalled();
});

test("validated caller receives bounded redacted progress and private headers", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    processed: 25,
    scanned: 25,
    remaining: true,
    busy: false,
  });
  expect(mocks.worker).toHaveBeenCalledWith(
    await mocks.client.mock.results[0].value,
    7,
    "UTC",
    expect.any(AbortSignal),
  );
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("Vary")).toBe("Cookie");
});

test("worker failure is generic and does not expose database messages", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.worker.mockRejectedValue(
    new Error("synthetic private database message"),
  );
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "PROJECTION_WORK_UNAVAILABLE",
  });
  expect(JSON.stringify(warn.mock.calls)).not.toContain("private database");
  warn.mockRestore();
});

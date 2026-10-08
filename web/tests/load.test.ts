import { afterEach, expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { loadDashboard } from "@/lib/data/load";
import { TUPLE_FACT_FIELDS } from "@/lib/data/compact";
import { advanceProjection } from "@/lib/data/projection";
import { refreshInventory } from "@/lib/data/inventory";
import type { Fact } from "@/lib/data/schema";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const failure = {
  data: null,
  error: { code: "57014", message: "private payload must never be logged" },
};
const compact = (
  records: unknown[],
  hasMore = false,
  cursor?: { start: string; id: string },
) => ({
  wire_version: 2,
  records: records.map((record) =>
    record &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    !("transport_invalid" in record)
      ? TUPLE_FACT_FIELDS.map((key) => (record as Record<string, unknown>)[key])
      : record,
  ),
  has_more: hasMore,
  next_start: hasMore
    ? (cursor?.start ?? (records.at(-1) as Fact)?.start)
    : null,
  next_id: hasMore ? (cursor?.id ?? (records.at(-1) as Fact)?.id) : null,
});
const success = (data: unknown) => ({
  data: Array.isArray(data) ? compact(data, data.length >= 2000) : data,
  error: null,
});
function source(
  replies: Record<string, (ReturnType<typeof success> | typeof failure)[]>,
) {
  const rpc = vi.fn((name: string, args?: Record<string, unknown>) => {
    void args;
    const result = replies[name]?.shift() ?? success([]);
    return Object.assign(Promise.resolve(result), {
      abortSignal: () => Promise.resolve(result),
    });
  });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}
const defaults = () => ({
  web_projection_status: [success({ remaining: false })],
  read_web_inventory_snapshot: [
    success({
      inventory: [],
      sync: null,
      snapshot: {
        as_of: new Date().toISOString(),
        stale: false,
        available: true,
        refresh_required: false,
      },
    }),
  ],
});
const fact = (): Fact => ({
  id: "00000000-0000-4000-8000-000000000010",
  kind: "steps",
  provider: "health_connect",
  origin: "live",
  source: "synthetic.example",
  channel: "synthetic-watch",
  rank: 300,
  start: new Date().toISOString(),
  end: new Date(Date.now() + 60000).toISOString(),
  received: new Date().toISOString(),
  value: 100,
  samples: 1,
  min: null,
  max: null,
  sessions: [],
  hourly: [],
  supported: true,
  bodyFat: null,
});

test.each([
  [7, "2025-01-06T05:00:00.000Z"],
  [28, "2025-01-06T05:00:00.000Z"],
  [90, "2024-12-08T05:00:00.000Z"],
  [365, "2024-03-08T05:00:00.000Z"],
] as const)(
  "read and durable worker retain the same padded %i-day timezone bounds",
  async (days, from) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2025-03-09T12:00:00Z"));
    const fake = source({
      ...defaults(),
      advance_web_projection: [
        success({ processed: 0, scanned: 0, remaining: false, busy: false }),
      ],
    });
    await loadDashboard(fake.client, days, "America/New_York");
    await advanceProjection(fake.client, days, "America/New_York");
    const expected = { p_from: from, p_until: "2025-03-10T04:00:00.000Z" };
    expect(
      fake.rpc.mock.calls.find(
        ([name]) => name === "web_projection_status",
      )?.[1],
    ).toMatchObject(expected);
    expect(
      fake.rpc.mock.calls.find(
        ([name]) => name === "web_tuple_facts_cursor",
      )?.[1],
    ).toMatchObject(expected);
    expect(
      fake.rpc.mock.calls.find(
        ([name]) => name === "advance_web_projection",
      )?.[1],
    ).toMatchObject(expected);
  },
);

test("GET serving calls only read RPCs and never does projection work", async () => {
  const fake = source(defaults());
  const result = await loadDashboard(fake.client, 7, "UTC");
  expect(fake.rpc.mock.calls.map(([name]) => name)).toEqual([
    "web_projection_status",
    "read_web_inventory_snapshot",
    "web_tuple_facts_cursor",
  ]);
  expect(result.partial).toBe(false);
  expect(result.queryCount).toBe(3);
  expect(result.projectionPending).toBe(false);
  expect(result.readIncomplete).toBe(false);
  expect(result.partialReasons).toEqual([]);
  expect(Object.keys(result.timings).sort()).toEqual([
    "analyticsMs",
    "inventoryMs",
    "pageMs",
    "rpcMs",
    "statusMs",
  ]);
  expect(
    Object.values(result.timings).every(
      (value) => Number.isFinite(value) && value >= 0,
    ),
  ).toBe(true);
});

test("status timeouts keep validated cached data partial and redact errors", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const fake = source({
    ...defaults(),
    web_projection_status: [failure],
    web_tuple_facts_cursor: [success([fact()])],
  });
  const result = await loadDashboard(fake.client, 7, "UTC");
  expect(result.partial).toBe(true);
  expect(result.projectionPending).toBe(true);
  expect(result.readIncomplete).toBe(false);
  expect(result.partialReasons).toEqual(["PROJECTION_STATUS_UNAVAILABLE"]);
  expect(result.readiness.score).toBeNull();
  expect(result.days.at(-1)?.steps).toBe(100);
  expect(JSON.stringify(warn.mock.calls)).not.toContain("private payload");
});

test("inventory failure retains valid charts without misclassifying fact coverage", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const fake = source({
    ...defaults(),
    read_web_inventory_snapshot: [failure],
    web_tuple_facts_cursor: [success([fact()])],
  });
  const result = await loadDashboard(fake.client, 7, "UTC");
  expect(result.partial).toBe(false);
  expect(result.days.at(-1)?.steps).toBe(100);
  expect(result.inventoryAvailable).toBe(false);
  expect(result.partialReasons).toEqual([]);
});

test("initial fact read failure is unavailable rather than an empty healthy day", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const fake = source({ ...defaults(), web_tuple_facts_cursor: [failure] });
  await expect(loadDashboard(fake.client, 7, "UTC")).rejects.toThrow(
    "DATA_READ_UNAVAILABLE",
  );
});

test("a short byte-limited page continues using its explicit canonical cursor", async () => {
  const first = fact();
  const second = { ...first, id: "00000000-0000-4000-8000-000000000009" };
  const fake = source({
    ...defaults(),
    web_tuple_facts_cursor: [
      success(compact([first], true, first)),
      success(compact([second])),
    ],
  });
  const result = await loadDashboard(fake.client, 7, "UTC");
  expect(result.partial).toBe(false);
  expect(result.queryCount).toBe(4);
  expect(fake.rpc.mock.calls.at(-1)?.[1]).toMatchObject({
    p_before_start: first.start,
    p_before_id: first.id,
    p_limit: 8000,
  });
});

test.each(["missing", "duplicate", "increasing", "cycle"])(
  "%s continuation fails closed while preserving earlier valid pages",
  async (mode) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = fact();
    const lower = {
      ...first,
      kind: "weight",
      value: 70,
      id: "00000000-0000-4000-8000-000000000009",
    };
    const higher = { ...first, id: "00000000-0000-4000-8000-000000000011" };
    const bad = compact([lower], true, mode === "increasing" ? higher : first);
    if (mode === "missing") bad.next_id = null;
    const pages = [success(compact([first], true, first))];
    if (mode === "cycle") pages.push(success(compact([lower], true, lower)));
    pages.push(success(bad));
    const fake = source({ ...defaults(), web_tuple_facts_cursor: pages });
    const result = await loadDashboard(fake.client, 7, "UTC");
    expect(result.partialReasons).toEqual(["READ_INCOMPLETE"]);
    expect(result.readIncomplete).toBe(true);
    expect(result.projectionPending).toBe(false);
    expect(result.days.at(-1)?.steps).toBe(100);
    expect(fake.rpc).toHaveBeenCalledTimes(mode === "cycle" ? 5 : 4);
  },
);

test("an initial malformed transport envelope is unavailable", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const fake = source({
    ...defaults(),
    web_tuple_facts_cursor: [
      success({ ...compact([fact()], true), next_id: null }),
    ],
  });
  await expect(loadDashboard(fake.client, 7, "UTC")).rejects.toThrow(
    "DATA_READ_UNAVAILABLE",
  );
});

test.each([
  [
    "2025-01-01T00:00:00.000002Z",
    "2025-01-01T00:00:00.000001Z",
    "00000000-0000-4000-8000-000000000011",
    false,
  ],
  [
    "2025-01-01T00:00:00.000002Z",
    "2025-01-01T01:00:00.000002+01:00",
    "00000000-0000-4000-8000-000000000009",
    false,
  ],
  [
    "2025-01-01T00:00:00.000001Z",
    "2025-01-01T00:00:00.000002Z",
    "00000000-0000-4000-8000-000000000009",
    true,
  ],
] as const)(
  "canonical microsecond/offset cursor ordering %s → %s",
  async (prior, next, id, incomplete) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fixture = fact();
    const fake = source({
      ...defaults(),
      web_tuple_facts_cursor: [
        success(compact([fixture], true, { start: prior, id: fixture.id })),
        success(
          compact([{ transport_invalid: true }], true, { start: next, id }),
        ),
        success(compact([])),
      ],
    });
    const result = await loadDashboard(fake.client, 7, "UTC");
    expect(result.readIncomplete).toBe(incomplete);
    expect(
      fake.rpc.mock.calls.filter(([name]) => name === "web_tuple_facts_cursor"),
    ).toHaveLength(incomplete ? 2 : 3);
    expect(result.days.at(-1)?.steps).toBe(100);
  },
);

test("invalid records count towards the 100k serving budget", async () => {
  const fixture = fact();
  const pages = Array.from({ length: 13 }, (_, index) =>
    success(
      compact(
        Array.from({ length: index === 12 ? 4000 : 8000 }, () => ({
          transport_invalid: true,
        })),
        true,
        {
          start: fixture.start,
          id: `00000000-0000-4000-8000-${(100 - index).toString().padStart(12, "0")}`,
        },
      ),
    ),
  );
  const fake = source({ ...defaults(), web_tuple_facts_cursor: pages });
  const result = await loadDashboard(fake.client, 7, "UTC");
  expect(result.invalidFacts).toBe(100000);
  expect(result.partialReasons).toEqual([
    "READ_INCOMPLETE",
    "INVALID_SUMMARIES",
  ]);
  expect(
    fake.rpc.mock.calls.filter(([name]) => name === "web_tuple_facts_cursor"),
  ).toHaveLength(13);
  expect(fake.rpc.mock.calls.at(-1)?.[1]).toMatchObject({ p_limit: 4000 });
});

test("later fact read failure retains earlier pages as explicitly partial", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const first = Array.from({ length: 2000 }, (_, index) => ({
    ...fact(),
    id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
  }));
  const fake = source({
    ...defaults(),
    web_tuple_facts_cursor: [success(first), failure],
  });
  const result = await loadDashboard(fake.client, 7, "UTC");
  expect(result.partial).toBe(true);
  expect(result.projectionPending).toBe(false);
  expect(result.readIncomplete).toBe(true);
  expect(result.partialReasons).toEqual(["READ_INCOMPLETE"]);
  expect(fake.rpc).toHaveBeenCalledTimes(4);
});

test("late fact pages use only the remaining 14s read budget and retain cached charts", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  let elapsed = 0;
  vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  const deadlines = vi.spyOn(AbortSignal, "timeout");
  const fixture = fact();
  const fake = source({
    ...defaults(),
    web_tuple_facts_cursor: [
      success(Array.from({ length: 2000 }, () => fixture)),
      failure,
    ],
  });
  const original = fake.rpc.getMockImplementation()!;
  let pages = 0;
  fake.rpc.mockImplementation((name, args) => {
    const response = original(name, args);
    if (name !== "web_tuple_facts_cursor") return response;
    return Object.assign(response, {
      abortSignal: () => {
        // Simulate first-page work including transport/validation overhead,
        // then the late page timing out at the overall read deadline.
        elapsed = ++pages === 1 ? 13249.4 : 14000;
        return response;
      },
    });
  });
  const result = await loadDashboard(fake.client, 7, "UTC");
  expect(deadlines.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
    8000, 8000, 8000, 750,
  ]);
  expect(pages).toBe(2);
  expect(result.partial).toBe(true);
  expect(result.projectionPending).toBe(false);
  expect(result.readIncomplete).toBe(true);
  expect(result.partialReasons).toEqual(["READ_INCOMPLETE"]);
  expect(result.days.at(-1)?.steps).toBe(100);
  expect(result.readiness.score).toBeNull();
});

test("exhausted serving budget starts no additional fact page", async () => {
  let elapsed = 0;
  vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  const fixture = fact();
  const fake = source({
    ...defaults(),
    web_tuple_facts_cursor: [
      success(Array.from({ length: 2000 }, () => fixture)),
    ],
  });
  const original = fake.rpc.getMockImplementation()!;
  fake.rpc.mockImplementation((name, args) => {
    const response = original(name, args);
    if (name !== "web_tuple_facts_cursor") return response;
    return Object.assign(response, {
      abortSignal: () => {
        elapsed = 14000;
        return response;
      },
    });
  });
  const result = await loadDashboard(fake.client, 7, "UTC");
  expect(
    fake.rpc.mock.calls.filter(([name]) => name === "web_tuple_facts_cursor"),
  ).toHaveLength(1);
  expect(result.partial).toBe(true);
  expect(result.projectionPending).toBe(false);
  expect(result.readIncomplete).toBe(true);
  expect(result.partialReasons).toEqual(["READ_INCOMPLETE"]);
  expect(result.days.at(-1)?.steps).toBe(100);
});

test("known projection backlog is distinct from incomplete read serving", async () => {
  const fake = source({
    ...defaults(),
    web_projection_status: [success({ remaining: true })],
    web_tuple_facts_cursor: [success([fact()])],
  });
  const result = await loadDashboard(fake.client, 7, "UTC");
  expect(result.partial).toBe(true);
  expect(result.projectionPending).toBe(true);
  expect(result.readIncomplete).toBe(false);
  expect(result.partialReasons).toEqual(["PROJECTION_PENDING"]);
  expect(result.readiness.score).toBeNull();
});

test("invalid summaries withhold analytics without inventing a projection backlog", async () => {
  const fake = source({
    ...defaults(),
    web_tuple_facts_cursor: [
      success([fact(), { ...fact(), value: "synthetic-invalid" }]),
    ],
  });
  const result = await loadDashboard(fake.client, 7, "UTC");
  expect(result.partial).toBe(true);
  expect(result.projectionPending).toBe(false);
  expect(result.readIncomplete).toBe(false);
  expect(result.partialReasons).toEqual(["INVALID_SUMMARIES"]);
  expect(result.invalidFacts).toBe(1);
  expect(result.readiness.score).toBeNull();
  expect(result.days.at(-1)?.steps).toBe(100);
});

test("worker is independently bounded and rejects malformed success metadata", async () => {
  const fake = source({
    advance_web_projection: [
      success({ processed: 50, scanned: 50, remaining: true, busy: false }),
    ],
  });
  expect((await advanceProjection(fake.client, 7, "UTC")).processed).toBe(50);
  expect(fake.rpc.mock.calls[0][1]).toMatchObject({ p_limit: 50 });
  expect(fake.rpc.mock.calls[0][0]).toBe("advance_web_projection");
  const malformed = source({
    advance_web_projection: [
      success({ processed: 51, scanned: 0, remaining: false, busy: false }),
    ],
  });
  await expect(advanceProjection(malformed.client, 7, "UTC")).rejects.toThrow();
});

test("aborted requests stop future pages and never start projection work", async () => {
  const controller = new AbortController();
  const fake = source({
    ...defaults(),
    web_tuple_facts_cursor: [
      success(Array.from({ length: 2000 }, () => fact())),
    ],
  });
  const original = fake.rpc.getMockImplementation()!;
  fake.rpc.mockImplementation((name: string) => {
    const response = original(name);
    if (name === "web_tuple_facts_cursor") controller.abort();
    return response;
  });
  await expect(
    loadDashboard(fake.client, 7, "UTC", controller.signal),
  ).rejects.toThrow();
  expect(
    fake.rpc.mock.calls.filter(([name]) => name === "web_tuple_facts_cursor"),
  ).toHaveLength(1);
  const abortedWorker = source({});
  await expect(
    advanceProjection(abortedWorker.client, 7, "UTC", controller.signal),
  ).rejects.toThrow();
  expect(abortedWorker.rpc).not.toHaveBeenCalled();
});

test("metadata worker validates its private result and sanitizes failures", async () => {
  const fake = source({
    refresh_web_inventory_snapshot: [
      success({
        refreshed: false,
        busy: true,
        snapshot: {
          as_of: null,
          available: false,
          stale: true,
          refresh_required: true,
        },
      }),
    ],
  });
  expect((await refreshInventory(fake.client, "UTC")).busy).toBe(true);
  const malformed = source({
    refresh_web_inventory_snapshot: [
      success({
        refreshed: true,
        busy: false,
        snapshot: {
          as_of: null,
          available: true,
          stale: false,
          refresh_required: false,
        },
      }),
    ],
  });
  await expect(refreshInventory(malformed.client, "UTC")).rejects.toThrow();
  const failed = source({ refresh_web_inventory_snapshot: [failure] });
  await expect(refreshInventory(failed.client, "UTC")).rejects.toThrow(
    "INVENTORY_WORK_UNAVAILABLE",
  );
});

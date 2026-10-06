import { createHandler } from "./handler.ts";
import { validBatch, validRecord } from "./validation.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function record(id = "synthetic-id") {
  return {
    provider: "health_connect",
    record_type: "steps",
    source_uid: id,
    source_package: null,
    source_device_id: null,
    device_provenance: {},
    start_time: "2025-01-01T00:00:00Z",
    end_time: null,
    source_zone_offset: "+05:30",
    end_zone_offset: null,
    source_created_at: null,
    source_updated_at: null,
    schema_version: 1,
    payload: { count: 1 },
    deleted: false,
    ingestion_origin: "live",
    source_priority: 0,
    client_revision: 1,
    observed_at: "2025-01-01T00:00:00Z",
  };
}
function batch(records = [record()]) {
  return {
    device: {
      device_uid: "synthetic-device",
      platform: "android",
      app_version: "synthetic-version",
    },
    records,
    runs: [],
  };
}
function request(body: unknown, authorization = "Bearer synthetic-token") {
  return new Request("https://example.invalid/functions/v1/sync-batch", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
const env = {
  url: "https://example.invalid",
  publicKey: "synthetic-public-key",
};

Deno.test("auth validation precedes persistence and untrusted ownership is rejected", async () => {
  let calls = 0;
  const handler = createHandler(
    env,
    ((_url, init) => {
      calls++;
      assert(
        init?.headers &&
          (init.headers as Record<string, string>).Authorization ===
            "Bearer synthetic-token",
      );
      return Promise.resolve(
        Response.json({ id: "synthetic-authenticated-user" }),
      );
    }) as typeof fetch,
  );
  assert(
    (await handler(request({ ...batch(), user_id: "forged-user" }))).status ===
      400,
  );
  assert(calls === 1);
  assert((await handler(request(batch(), ""))).status === 401);
  assert(calls === 1);
});
Deno.test("invalid JWT never reaches the database", async () => {
  let calls = 0;
  const handler = createHandler(
    env,
    (() => {
      calls++;
      return Promise.resolve(new Response("", { status: 401 }));
    }) as typeof fetch,
  );
  assert((await handler(request(batch()))).status === 401);
  assert(calls === 1);
});
Deno.test("validated JWT forwarded to atomic RPC; all records acknowledged", async () => {
  const calls: string[] = [];
  const handler = createHandler(
    env,
    ((url, init) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return Promise.resolve(
          Response.json({ id: "synthetic-authenticated-user" }),
        );
      }
      const args = JSON.parse(String(init?.body));
      assert(!("user_id" in args) && !("user_id" in args.p_records[0]));
      assert(
        (init?.headers as Record<string, string>).Authorization ===
          "Bearer synthetic-token",
      );
      return Promise.resolve(Response.json({ accepted: 1, runs_accepted: 0 }));
    }) as typeof fetch,
  );
  assert((await handler(request(batch()))).status === 200);
  assert(calls[1].endsWith("/rest/v1/rpc/ingest_health_batch"));
});
Deno.test("persistence failure or incomplete acknowledgement never reports success", async () => {
  for (
    const result of [
      new Response("", { status: 500 }),
      Response.json({ accepted: 0, runs_accepted: 0 }),
    ]
  ) {
    let calls = 0;
    const handler = createHandler(
      env,
      (() =>
        Promise.resolve(
          ++calls === 1 ? Response.json({ id: "synthetic-user" }) : result,
        )) as typeof fetch,
    );
    assert((await handler(request(batch()))).status === 503);
  }
});
Deno.test("record count boundary, duplicate identity and malformed records", () => {
  assert(
    validBatch(
      batch(Array.from({ length: 500 }, (_, i) => record(`synthetic-${i}`))),
    ),
  );
  assert(
    !validBatch(
      batch(Array.from({ length: 501 }, (_, i) => record(`synthetic-${i}`))),
    ),
  );
  assert(!validBatch(batch([record(), record()])));
  assert(!validRecord({ ...record(), start_time: null }));
  assert(validRecord({ ...record(), start_time: null, deleted: true }));
  assert(!validRecord({ ...record(), source_zone_offset: "+18:01" }));
  assert(!validRecord({ ...record(), end_time: "2024-01-01T00:00:00Z" }));
  assert(!validRecord({ ...record(), user_id: "forged" }));
  assert(!validRecord({ ...record(), payload: [] }));
  assert(!validRecord({ ...record(), payload: { value: "x".repeat(262144) } }));
});
Deno.test("HTTP method and content type rejected", async () => {
  const handler = createHandler(
    env,
    (() => {
      throw new Error("unexpected network");
    }) as typeof fetch,
  );
  assert(
    (await handler(new Request("https://example.invalid"))).status === 405,
  );
  assert(
    (await handler(
      new Request("https://example.invalid", {
        method: "POST",
        headers: { Authorization: "Bearer synthetic-token" },
      }),
    )).status === 415,
  );
});
Deno.test("oversized streamed body rejected without database access", async () => {
  let calls = 0;
  const handler = createHandler(
    env,
    (() => {
      calls++;
      return Promise.resolve(Response.json({ id: "synthetic-user" }));
    }) as typeof fetch,
  );
  const oversized = new Request("https://example.invalid", {
    method: "POST",
    headers: {
      Authorization: "Bearer synthetic-token",
      "Content-Type": "application/json",
    },
    body: "x".repeat(8 * 1024 * 1024 + 1),
  });
  assert((await handler(oversized)).status === 413);
  assert(calls === 1);
});

Deno.test("audited historical raw types preserve undated configuration and never fabricate RMSSD", () => {
  const goal = {
    ...record(),
    provider: "samsung_health",
    record_type: "training_load_goal",
    ingestion_origin: "historical",
    start_time: null,
  };
  assert(validRecord(goal));
  assert(validRecord({ ...goal, record_type: "vendor_raw" }));
  assert(!validRecord({ ...goal, record_type: "steps" }));
  assert(!validRecord({ ...goal, ingestion_origin: "live" }));
  assert(
    !validRecord({
      ...record(),
      provider: "samsung_health",
      record_type: "hrv_rmssd",
    }),
  );
  assert(
    validRecord({
      ...record(),
      provider: "samsung_health",
      record_type: "hrv_envelope",
      ingestion_origin: "historical",
      payload: { binning_data: "synthetic.json" },
    }),
  );
});

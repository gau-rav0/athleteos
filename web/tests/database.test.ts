import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const owner = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002";
let db: PGlite;
async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function refresh() {
  return db.query<{ result: { processed: number; remaining: boolean } }>(
    "select public.refresh_web_facts('2025-01-01Z','2025-02-01Z',1000) result",
  );
}
describe("authenticated SQL projections", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
    );
    for (const name of [
      "0001_phase1.sql",
      "0002_phase1_ingestion.sql",
      "0003_payload_wire_size.sql",
      "0004_dense_payloads.sql",
      "0005_web_dashboard_facts.sql",
      "0006_web_projection_reads.sql",
      "0007_web_projection_refresh.sql",
      "0008_web_projection_checkpoint.sql",
      "0009_web_inventory_snapshot.sql",
    ]) {
      let sql = readFileSync(resolve("../supabase/migrations", name), "utf8");
      sql = sql.replace("create extension if not exists pgcrypto;", "");
      await db.exec(sql);
    }
    await db.query("insert into auth.users values($1),($2)", [owner, other]);
    await db.query(
      "insert into public.raw_health_records(user_id,provider,record_type,source_uid,start_time,end_time,payload) values($1,'health_connect','steps','synthetic-step','2025-01-10T00:00Z','2025-01-10T01:00Z',$2)",
      [owner, JSON.stringify({ metadata: {}, count: 100 })],
    );
  });
  afterAll(async () => {
    await db.close();
  });
  it("normalizes source schema and caches compact facts", async () => {
    await user(owner);
    const result = await refresh();
    expect(result.rows[0].result.processed).toBe(1);
    const rows = await db.query<{ result: { value: number; kind: string }[] }>(
      "select public.web_facts_page('2025-01-01Z','2025-02-01Z',0) result",
    );
    expect(rows.rows[0].result[0].value).toBe(100);
    expect(rows.rows[0].result[0].kind).toBe("steps");
  });
  it("is idempotent when no raw revision changes", async () => {
    await user(owner);
    expect((await refresh()).rows[0].result.processed).toBe(0);
  });
  it("isolates a second authenticated user and rejects anonymous calls", async () => {
    await user(other);
    expect(
      (
        await db.query<{ result: unknown[] }>(
          "select public.web_facts_page('2025-01-01Z','2025-02-01Z',0) result",
        )
      ).rows[0].result,
    ).toEqual([]);
    expect(
      (
        await db.query<{ result: { inventory: unknown[] } }>(
          "select public.web_inventory('UTC') result",
        )
      ).rows[0].result.inventory,
    ).toEqual([]);
    await db.exec("reset role;set role anon");
    await expect(refresh()).rejects.toThrow();
    await db.exec("reset role");
  });
  it("rejects invalid windows and offsets", async () => {
    await user(owner);
    await expect(
      db.query(
        "select public.refresh_web_facts('2020-01-01Z','2025-01-01Z',1000)",
      ),
    ).rejects.toThrow();
    await expect(
      db.query("select public.web_facts_page('2025-01-01Z','2025-02-01Z',-1)"),
    ).rejects.toThrow();
  });
  it("invalidates updates and excludes tombstones immediately", async () => {
    await user(owner);
    await db.exec(
      "update public.raw_health_records set payload='{\"metadata\":{},\"count\":200}',received_at=received_at+interval '1 second'",
    );
    expect(
      (
        await db.query<{ result: unknown[] }>(
          "select public.web_facts_page('2025-01-01Z','2025-02-01Z',0) result",
        )
      ).rows[0].result,
    ).toEqual([]);
    await refresh();
    await db.exec("update public.raw_health_records set deleted=true");
    expect(
      (
        await db.query<{ result: unknown[] }>(
          "select public.web_facts_page('2025-01-01Z','2025-02-01Z',0) result",
        )
      ).rows[0].result,
    ).toEqual([]);
  });
  it("keeps proprietary Samsung HRV separate from RMSSD", async () => {
    await db.exec("reset role");
    await db.query(
      "insert into public.raw_health_records(user_id,provider,record_type,source_uid,start_time,payload) values($1,'samsung_health','energy_score','synthetic-vendor','2025-01-11T00:00Z',$2)",
      [
        owner,
        JSON.stringify({
          sdk_version: "1.1.0",
          fields: { total_score: 70, shrv_value: 999 },
        }),
      ],
    );
    await user(owner);
    await refresh();
    const rows = await db.query<{ result: { kind: string; value: number }[] }>(
      "select public.web_facts_page('2025-01-01Z','2025-02-01Z',0) result",
    );
    expect(rows.rows[0].result[0].kind).toBe("energy_score");
    expect(rows.rows[0].result[0].value).toBe(70);
  });
  it("summarizes massive HC samples without returning raw arrays", async () => {
    await db.exec("reset role");
    const samples = Array.from({ length: 15000 }, (_, i) => ({
      time: new Date(Date.parse("2025-01-12T01:00Z") + i * 1000).toISOString(),
      beats_per_minute: 60 + (i % 5),
    }));
    await db.query(
      "insert into public.raw_health_records(user_id,provider,record_type,source_uid,start_time,end_time,payload) values($1,'health_connect','heart_rate','synthetic-dense','2025-01-12T00:00Z','2025-01-12T06:00Z',$2)",
      [owner, JSON.stringify({ metadata: {}, samples })],
    );
    await user(owner);
    await refresh();
    const rows = await db.query<{
      fact: { samples: number; hourly: unknown[] };
    }>(
      "select fact from public.web_health_facts where fact->>'kind'='heart_rate'",
    );
    expect(rows.rows[0].fact.samples).toBe(15000);
    expect(rows.rows[0].fact.hourly.length).toBeLessThan(7);
    expect(JSON.stringify(rows.rows[0].fact).length).toBeLessThan(3000);
  });
  it("maps Samsung kg, vendor duration and enum sleep stages", async () => {
    await db.exec("reset role");
    for (const [kind, fields] of [
      ["body_composition", { weight: 80, body_fat: 18 }],
      [
        "sleep",
        {
          sessions: [
            {
              startTime: "2025-01-13T23:00:00Z",
              endTime: "2025-01-14T07:00:00Z",
              duration: "PT7H30M",
              stages: [
                {
                  startTime: "2025-01-13T23:00:00Z",
                  endTime: "2025-01-14T00:00:00Z",
                  stage: "DEEP",
                },
              ],
            },
          ],
        },
      ],
      [
        "exercise",
        {
          sessions: [
            {
              startTime: "2025-01-14T10:00:00Z",
              endTime: "2025-01-14T11:00:00Z",
              duration: "PT50M",
              exerciseType: "RUNNING",
            },
          ],
        },
      ],
    ] as const) {
      await db.query(
        "insert into public.raw_health_records(user_id,provider,record_type,source_uid,start_time,end_time,payload) values($1,'samsung_health',$2,$3,'2025-01-14T00:00Z','2025-01-14T12:00Z',$4)",
        [
          owner,
          kind,
          "synthetic-sdk-" + kind,
          JSON.stringify({ sdk_version: "1.1.0", fields }),
        ],
      );
    }
    await user(owner);
    await refresh();
    const { rows } = await db.query<{
      fact: {
        kind: string;
        value: number;
        bodyFat: number;
        sessions: {
          minutes: number;
          stages: { deep: number };
          category: string;
          durationBasis: string;
        }[];
      };
    }>(
      "select fact from public.web_health_facts where fact->>'kind' in ('body_composition','sleep','exercise')",
    );
    const body = rows.find((r) => r.fact.kind === "body_composition")!.fact;
    expect(body.value).toBe(80);
    expect(body.bodyFat).toBe(18);
    const sleep = rows.find((r) => r.fact.kind === "sleep")!.fact.sessions[0];
    expect(sleep.minutes).toBe(450);
    expect(sleep.stages.deep).toBe(60);
    expect(sleep.durationBasis).toBe("vendor_duration");
    const exercise = rows.find((r) => r.fact.kind === "exercise")!.fact
      .sessions[0];
    expect(exercise.minutes).toBe(50);
    expect(exercise.category).toBe("RUNNING");
  });
  it("uses indexed bounded windows with 200,000 synthetic raw records", async () => {
    await db.exec("reset role");
    await db.query(
      "insert into public.raw_health_records(user_id,provider,record_type,source_uid,start_time,end_time,payload) select $1,'health_connect','steps','synthetic-bulk-'||i, '2023-01-01T00:00Z'::timestamptz+i*interval '5 minutes','2023-01-01T00:00Z'::timestamptz+(i+1)*interval '5 minutes','{\"metadata\":{},\"count\":100}'::jsonb from generate_series(1,200000) i",
      [owner],
    );
    await user(owner);
    const start = performance.now();
    const result = await db.query<{ result: { processed: number } }>(
      "select public.refresh_web_facts('2023-01-01Z','2023-02-01Z',1000) result",
    );
    expect(result.rows[0].result.processed).toBe(1000);
    const page = await db.query<{ result: unknown[] }>(
      "select public.web_facts_page('2023-01-01Z','2023-02-01Z',0) result",
    );
    expect(page.rows[0].result.length).toBe(1000);
    console.info(
      JSON.stringify({
        syntheticRawRecords: 200000,
        refreshAndPageMs: Math.round(performance.now() - start),
        compactPageBytes: JSON.stringify(page.rows[0].result).length,
      }),
    );
    // Optional synthetic profiling only. The unproven index is not a migration
    // and is never applied by the normal validation/deployment path.
    if (process.env.ATHLETEOS_PROFILE_INDEX === "1") {
      await db.exec("reset role");
      await db.exec("begin");
      await db.exec(
        readFileSync(
          resolve("../docs/performance/RAW_INVENTORY_INDEX_CANDIDATE.sql"),
          "utf8",
        ),
      );
      await db.exec("commit");
      await db.exec("vacuum analyze public.raw_health_records");
      await user(owner);
      const inventoryPlan = await db.query<{
        "QUERY PLAN": { Plan: { Plans?: unknown[] } }[];
      }>(
        "explain (format json) select provider,record_type,count(*),count(distinct (start_time at time zone 'UTC')::date),min(start_time),max(start_time),max(received_at),count(*) filter(where ingestion_origin='historical') from public.raw_health_records where user_id=(select auth.uid()) and not deleted group by provider,record_type",
      );
      const planText = JSON.stringify(inventoryPlan.rows);
      console.info(
        JSON.stringify({
          syntheticInventoryIndexOnly: planText.includes("Index Only Scan"),
          syntheticInventoryCoveringIndexUsed: planText.includes(
            "raw_web_inventory_covering",
          ),
        }),
      );
      const inventoryStart = performance.now();
      const indexedInventory = await db.query<{ result: unknown }>(
        "select public.web_inventory('UTC') result",
      );
      const indexedInventoryMs = Math.round(performance.now() - inventoryStart);
      await db.exec("reset role;drop index public.raw_web_inventory_covering");
      await user(owner);
      const unindexedStart = performance.now();
      const unindexedInventory = await db.query<{ result: unknown }>(
        "select public.web_inventory('UTC') result",
      );
      expect(indexedInventory.rows[0].result).toEqual(
        unindexedInventory.rows[0].result,
      );
      console.info(
        JSON.stringify({
          syntheticRawRecords: 200000,
          indexedInventoryMs,
          unindexedInventoryMs: Math.round(performance.now() - unindexedStart),
        }),
      );
    }
    const workerStart = performance.now();
    const worker = await db.query<{
      result: { processed: number; scanned: number; remaining: boolean };
    }>(
      "select public.advance_web_projection('2023-01-01Z','2023-02-01Z',25) result",
    );
    expect(worker.rows[0].result.processed).toBe(25);
    expect(worker.rows[0].result.scanned).toBe(1025);
    const workerMs = Math.round(performance.now() - workerStart);
    const readStart = performance.now();
    await db.query(
      "select public.web_projection_status('2023-01-01Z','2023-02-01Z')",
    );
    const keyset = await db.query<{ result: unknown[] }>(
      "select public.web_facts_cursor('2023-01-01Z','2023-02-01Z',null,null,1000) result",
    );
    expect(keyset.rows[0].result.length).toBe(1000);
    console.info(
      JSON.stringify({
        syntheticRawRecords: 200000,
        workerMs,
        workerScanned: worker.rows[0].result.scanned,
        readOnlyStatusAndPageMs: Math.round(performance.now() - readStart),
      }),
    );
  });
});

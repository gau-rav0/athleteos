import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const owner = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002";
let db: PGlite;
const from = "2025-01-01Z",
  until = "2025-02-01Z";
async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function worker(limit = 25, start = from, end = until) {
  return (
    await db.query<{
      result: { processed: number; scanned: number; remaining: boolean };
    }>("select public.advance_web_projection($1,$2,$3) result", [
      start,
      end,
      limit,
    ])
  ).rows[0].result;
}
async function status() {
  return (
    await db.query<{ result: { remaining: boolean } }>(
      "select public.web_projection_status($1,$2) result",
      [from, until],
    )
  ).rows[0].result;
}
async function page(
  beforeStart: string | null = null,
  beforeId: string | null = null,
  limit = 2000,
) {
  return (
    await db.query<{ result: { id: string; start: string; value: number }[] }>(
      "select public.web_facts_cursor($1,$2,$3,$4,$5) result",
      [from, until, beforeStart, beforeId, limit],
    )
  ).rows[0].result;
}
describe("time-budgeted durable projections", () => {
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
      "0010_web_compact_fact_reads.sql",
      "0011_web_tuple_fact_reads.sql",
      "0012_web_projection_time_budget.sql",
    ]) {
      await db.exec(
        readFileSync(resolve("../supabase/migrations", name), "utf8").replace(
          "create extension if not exists pgcrypto;",
          "",
        ),
      );
    }
    await db.query("insert into auth.users values($1),($2)", [owner, other]);
    await db.query(
      "insert into public.raw_health_records(user_id,provider,record_type,source_uid,start_time,end_time,payload) select $1,'health_connect','steps','synthetic-checkpoint-'||i,'2025-01-10T00:00Z'::timestamptz+i*interval '1 hour','2025-01-10T00:00Z'::timestamptz+(i+1)*interval '1 hour','{\"metadata\":{},\"count\":100}'::jsonb from generate_series(1,3) i",
      [owner],
    );
  });
  afterAll(async () => {
    await db.close();
  });
  it("read status does not extract, and bounded workers resume durable progress", async () => {
    await user(owner);
    expect((await status()).remaining).toBe(true);
    expect(await page()).toEqual([]);
    const first = await worker(1);
    expect(first).toMatchObject({ processed: 1, scanned: 1, remaining: true });
    expect((await page()).length).toBe(1);
    const next = await worker(1);
    expect(next).toMatchObject({ processed: 1, scanned: 1, remaining: true });
    expect((await worker()).remaining).toBe(false);
    expect(await worker()).toMatchObject({
      processed: 0,
      scanned: 0,
      remaining: false,
    });
  });
  it("keyset paging is disjoint and bounded without OFFSET rescans", async () => {
    await user(owner);
    const first = await page(null, null, 2),
      last = first.at(-1)!;
    const next = await page(last.start, last.id, 2);
    expect(first.length).toBe(2);
    expect(next.length).toBe(1);
    expect(new Set([...first, ...next].map((r) => r.id)).size).toBe(3);
  });
  it("changed raw revision is excluded immediately, marks partial and reconciles", async () => {
    await user(owner);
    await db.exec(
      "update public.raw_health_records set payload='{\"metadata\":{},\"count\":200}',received_at=received_at+interval '1 second' where source_uid='synthetic-checkpoint-1'",
    );
    expect((await status()).remaining).toBe(true);
    expect((await page()).length).toBe(2);
    expect((await worker()).processed).toBe(1);
    expect((await status()).remaining).toBe(false);
    expect((await page()).some((r) => r.value === 200)).toBe(true);
  });
  it("cancellation rolls back fact and checkpoint progress together", async () => {
    await user(owner);
    await db.exec(
      "update public.raw_health_records set payload='{\"metadata\":{},\"count\":300}',received_at=received_at+interval '2 seconds' where source_uid='synthetic-checkpoint-2'",
    );
    await db.exec("begin");
    expect((await worker()).processed).toBe(1);
    await db.exec("rollback");
    expect((await status()).remaining).toBe(true);
    expect((await page()).some((r) => r.value === 300)).toBe(false);
    expect((await worker()).processed).toBe(1);
  });
  it("tombstones disappear immediately and periodic reconciliation remains conservative", async () => {
    await user(owner);
    await db.exec(
      "update public.raw_health_records set deleted=true,received_at=received_at+interval '10 seconds' where source_uid='synthetic-checkpoint-3'",
    );
    expect((await page()).length).toBe(2);
    await worker();
    await db.exec(
      "update public.web_projection_windows set updated_at=now()-interval '16 minutes'",
    );
    expect((await status()).remaining).toBe(true);
    expect((await worker()).processed).toBe(0);
    expect((await status()).remaining).toBe(false);
  });
  it("reconciles newly received records whose original date is behind the cursor", async () => {
    await user(owner);
    await db.query(
      "insert into public.raw_health_records(user_id,provider,record_type,source_uid,start_time,end_time,payload,received_at) values($1,'health_connect','steps','synthetic-late-old-date','2025-01-02T00:00Z','2025-01-02T01:00Z','{\"metadata\":{},\"count\":400}',(select max(received_at)+interval '1 second' from public.raw_health_records))",
      [owner],
    );
    expect((await status()).remaining).toBe(true);
    expect((await worker()).processed).toBe(1);
    expect((await page()).some((row) => row.value === 400)).toBe(true);
    expect((await status()).remaining).toBe(false);
  });
  it("periodic scan catches a late commit whose received watermark is older", async () => {
    await user(owner);
    await db.query(
      "insert into public.raw_health_records(user_id,provider,record_type,source_uid,start_time,end_time,payload,received_at) values($1,'health_connect','steps','synthetic-late-commit','2025-01-03T00:00Z','2025-01-03T01:00Z','{\"metadata\":{},\"count\":500}',(select min(received_at)-interval '1 minute' from public.raw_health_records))",
      [owner],
    );
    await db.exec(
      "update public.web_projection_windows set updated_at=now()-interval '16 minutes'",
    );
    expect((await status()).remaining).toBe(true);
    expect((await worker()).processed).toBe(1);
    expect((await page()).some((row) => row.value === 500)).toBe(true);
  });
  it("isolates checkpoints and facts, rejects anonymous and invalid bounds", async () => {
    await user(other);
    expect(await page()).toEqual([]);
    expect(
      (await db.query("select * from public.web_projection_windows")).rows,
    ).toEqual([]);
    expect((await worker()).processed).toBe(0);
    await expect(worker(51)).rejects.toThrow();
    await expect(page(null, null, 2001)).rejects.toThrow();
    await expect(
      db.query("select public.web_projection_status(null,$1)", [until]),
    ).rejects.toThrow();
    await expect(
      db.query("select public.advance_web_projection($1,null,25)", [from]),
    ).rejects.toThrow();
    await expect(
      db.query("select public.web_facts_cursor($1,$2,null,null,null)", [
        from,
        until,
      ]),
    ).rejects.toThrow();
    await db.exec("reset role;set role anon");
    await expect(status()).rejects.toThrow();
    await expect(worker()).rejects.toThrow();
    await expect(page()).rejects.toThrow();
  });
  it("commits dense safe prefixes and resumes every identity; rollback restores both state tables", async () => {
    await db.exec("reset role");
    const samples = Array.from({ length: 15000 }, (_, i) => ({
      time: new Date(
        Date.parse("2025-03-12T01:00:00Z") + i * 1000,
      ).toISOString(),
      beats_per_minute: 60 + (i % 5),
    }));
    await db.query(
      "insert into public.raw_health_records(user_id,provider,record_type,source_uid,start_time,end_time,payload) select $1,'health_connect','heart_rate','synthetic-budget-dense-'||i,'2025-03-12T00:00Z','2025-03-12T06:00Z',$2::jsonb from generate_series(1,8) i",
      [owner, JSON.stringify({ metadata: {}, samples })],
    );
    await user(owner);
    const start = "2025-03-01Z",
      end = "2025-04-01Z";
    await db.exec("begin");
    const first = await worker(50, start, end);
    expect(first.processed).toBeGreaterThan(0);
    expect(first.processed).toBeLessThan(8);
    expect(first.remaining).toBe(true);
    const prefix = (
      await db.query<{ raw_id: string }>(
        "select raw_id from public.web_health_facts where start_time>=$1 and start_time<$2",
        [start, end],
      )
    ).rows;
    expect(prefix).toHaveLength(first.processed);
    await db.exec("rollback");
    expect(
      (
        await db.query(
          "select raw_id from public.web_health_facts where start_time>=$1 and start_time<$2",
          [start, end],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.query(
          "select * from public.web_projection_windows where from_time=$1 and until_time=$2",
          [start, end],
        )
      ).rows,
    ).toEqual([]);
    let completed = false,
      processed = 0;
    for (let runs = 0; runs < 9 && !completed; runs++) {
      const result = await worker(50, start, end);
      processed += result.processed;
      completed = !result.remaining;
    }
    expect(completed).toBe(true);
    expect(processed).toBe(8);
    const ids = (
      await db.query<{ raw_id: string }>(
        "select raw_id from public.web_health_facts where start_time>=$1 and start_time<$2",
        [start, end],
      )
    ).rows.map((r) => r.raw_id);
    expect(new Set(ids).size).toBe(8);
    const raw = (
      await db.query<{ id: string }>(
        "select id from public.raw_health_records where source_uid like 'synthetic-budget-dense-%'",
      )
    ).rows.map((r) => r.id);
    expect(ids.sort()).toEqual(raw.sort());
  }, 30000);
  it("retains exact50 batch boundary and remaining-one resumption for scalar records", async () => {
    await db.exec("reset role");
    await db.query(
      "insert into public.raw_health_records(user_id,provider,record_type,source_uid,start_time,end_time,payload) select $1,'health_connect','steps','synthetic-budget-scalar-'||i,'2025-05-12T00:00Z','2025-05-12T01:00Z','{\"metadata\":{},\"count\":100}'::jsonb from generate_series(1,51) i",
      [owner],
    );
    await user(owner);
    expect(await worker(50, "2025-05-01Z", "2025-06-01Z")).toMatchObject({
      processed: 50,
      scanned: 50,
      remaining: true,
    });
    expect(await worker(50, "2025-05-01Z", "2025-06-01Z")).toMatchObject({
      processed: 1,
      scanned: 1,
      remaining: false,
    });
    expect(await worker(50, "2025-05-01Z", "2025-06-01Z")).toMatchObject({
      processed: 0,
      scanned: 0,
      remaining: false,
    });
  });
  it("time exit also bounds cached metadata and cannot mark an unconsumed suffix complete", async () => {
    await user(owner);
    await db.exec("begin");
    await db.exec(
      "update public.web_projection_windows set completed=false,cursor_time=null,cursor_id=null,scanned=0 where from_time='2025-05-01Z' and until_time='2025-06-01Z'",
    );
    await db.exec("reset role");
    const source = readFileSync(
      resolve("../supabase/migrations/0012_web_projection_time_budget.sql"),
      "utf8",
    );
    expect(source).toContain("clock_timestamp()+interval '4 seconds'");
    // Only the test-local clock boundary changes. Transaction rollback restores
    // the real 4s function and its checkpoint, without sleeps or huge fixtures.
    await db.exec(
      source.replace("interval '4 seconds'", "interval '0 seconds'"),
    );
    await db.exec("set role authenticated");
    const result = await worker(50, "2025-05-01Z", "2025-06-01Z");
    expect(result).toMatchObject({ processed: 0, scanned: 1, remaining: true });
    await db.exec("rollback");
    expect(await worker(50, "2025-05-01Z", "2025-06-01Z")).toMatchObject({
      processed: 0,
      remaining: false,
    });
  });
});

import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const owner = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002";
let db: PGlite;
type Snapshot = {
  as_of: string | null;
  available: boolean;
  stale: boolean;
  refresh_required: boolean;
};
type ReadResult = {
  inventory: { records: number; observed_days: number }[];
  snapshot: Snapshot;
};
async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function read(timezone = "UTC") {
  return (
    await db.query<{ result: ReadResult }>(
      "select public.read_web_inventory_snapshot($1) result",
      [timezone],
    )
  ).rows[0].result;
}
async function refresh(timezone = "UTC") {
  return (
    await db.query<{
      result: { refreshed: boolean; busy: boolean; snapshot: Snapshot };
    }>("select public.refresh_web_inventory_snapshot($1) result", [timezone])
  ).rows[0].result;
}
describe("owner-scoped raw inventory snapshots", () => {
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
      await db.exec(
        readFileSync(resolve("../supabase/migrations", name), "utf8").replace(
          "create extension if not exists pgcrypto;",
          "",
        ),
      );
    }
    await db.query("insert into auth.users values($1),($2)", [owner, other]);
    await db.query(
      "insert into public.raw_health_records(user_id,provider,record_type,source_uid,start_time,payload) values($1,'health_connect','steps','synthetic-inventory-a','2025-01-01T23:30Z','{\"metadata\":{},\"count\":100}'),($1,'health_connect','steps','synthetic-inventory-b','2025-01-02T00:30Z','{\"metadata\":{},\"count\":100}')",
      [owner],
    );
  });
  afterAll(async () => {
    await db.close();
  });
  it("read serves unavailable metadata without performing aggregation or writes", async () => {
    await user(owner);
    expect((await read()).snapshot).toEqual({
      as_of: null,
      available: false,
      stale: true,
      refresh_required: true,
    });
    expect(
      (await db.query("select * from public.web_inventory_snapshots")).rows,
    ).toEqual([]);
  });
  it("worker captures exact raw counts and suppresses repeated expensive scans", async () => {
    await user(owner);
    expect((await refresh()).refreshed).toBe(true);
    const first = await read();
    expect(first.inventory[0]).toMatchObject({ records: 2, observed_days: 2 });
    expect(first.snapshot).toMatchObject({
      available: true,
      stale: false,
      refresh_required: false,
    });
    const again = await refresh();
    expect(again.refreshed).toBe(false);
    expect(again.snapshot.as_of).toBe(first.snapshot.as_of);
    const exact = (
      await db.query<{ result: ReadResult }>(
        "select public.web_inventory('UTC') result",
      )
    ).rows[0].result;
    expect(first.inventory).toEqual(exact.inventory);
  });
  it("new raw batches mark snapshots stale but wait five minutes before refreshing", async () => {
    await user(owner);
    await db.query(
      "insert into public.raw_health_records(user_id,provider,record_type,source_uid,start_time,payload,received_at) values($1,'health_connect','steps','synthetic-inventory-c','2025-01-03T00:00Z','{\"metadata\":{},\"count\":100}',(select max(received_at)+interval '1 second' from public.raw_health_records))",
      [owner],
    );
    const stale = await read();
    expect(stale.inventory[0].records).toBe(2);
    expect(stale.snapshot).toMatchObject({
      available: true,
      stale: true,
      refresh_required: false,
    });
    expect((await refresh()).refreshed).toBe(false);
    await db.exec(
      "update public.web_inventory_snapshots set captured_at=now()-interval '6 minutes'",
    );
    expect((await read()).snapshot.refresh_required).toBe(true);
    expect((await refresh()).refreshed).toBe(true);
    expect((await read()).inventory[0].records).toBe(3);
  });
  it("rollback retains the prior validated snapshot and canonical raw records", async () => {
    await user(owner);
    const before = await read();
    await db.exec(
      "update public.raw_health_records set deleted=true,received_at=received_at+interval '2 seconds' where source_uid='synthetic-inventory-c';update public.web_inventory_snapshots set captured_at=now()-interval '6 minutes'",
    );
    await db.exec("begin");
    await refresh();
    expect((await read()).inventory[0].records).toBe(2);
    await db.exec("rollback");
    expect((await read()).inventory).toEqual(before.inventory);
    expect(
      (await db.query("select id from public.raw_health_records")).rows,
    ).toHaveLength(3);
    await refresh();
    expect((await read()).inventory[0].records).toBe(2);
  });
  it("worker failure preserves the prior snapshot without accepting replacement", async () => {
    await user(owner);
    await db.exec(
      "update public.web_inventory_snapshots set captured_at=now()-interval '6 minutes'",
    );
    const before = await read();
    await db.exec(
      "reset role;revoke execute on function public.web_inventory(text) from authenticated",
    );
    await user(owner);
    await expect(refresh()).rejects.toThrow();
    expect((await read()).inventory).toEqual(before.inventory);
    expect((await read()).snapshot.as_of).toBe(before.snapshot.as_of);
    await db.exec(
      "reset role;grant execute on function public.web_inventory(text) to authenticated",
    );
    await user(owner);
    await refresh();
  });
  it("snapshots preserve timezone coverage and isolate second-user/anonymous access", async () => {
    await user(owner);
    await refresh("Asia/Kolkata");
    expect((await read("Asia/Kolkata")).inventory[0].observed_days).toBe(1);
    await user(other);
    expect((await read()).snapshot.available).toBe(false);
    expect(
      (await db.query("select * from public.web_inventory_snapshots")).rows,
    ).toEqual([]);
    expect((await refresh()).refreshed).toBe(true);
    expect((await read()).inventory).toEqual([]);
    const crossOwnerUpdate = await db.query(
      "update public.web_inventory_snapshots set inventory='[]' where user_id=$1 returning user_id",
      [owner],
    );
    expect(crossOwnerUpdate.rows).toEqual([]);
    await expect(
      db.query(
        "insert into public.web_inventory_snapshots(user_id,timezone,inventory,captured_at) values($1,'America/Chicago','[]',now())",
        [owner],
      ),
    ).rejects.toThrow();
    await expect(read("invalid/timezone")).rejects.toThrow();
    await expect(
      db.query("select public.refresh_web_inventory_snapshot(null)"),
    ).rejects.toThrow();
    await db.exec("reset role;set role anon");
    await expect(read()).rejects.toThrow();
    await expect(refresh()).rejects.toThrow();
    await expect(
      db.query("select * from public.web_inventory_snapshots"),
    ).rejects.toThrow();
  });
});

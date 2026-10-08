import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeCompactPage } from "@/lib/data/compact";
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
async function read(
  beforeStart: string | null = null,
  beforeId: string | null = null,
  limit = 8000,
) {
  const result = (
    await db.query<{ result: unknown }>(
      "select public.web_tuple_facts_cursor($1,$2,$3,$4,$5) result",
      [from, until, beforeStart, beforeId, limit],
    )
  ).rows[0].result;
  const original = (
    await db.query<{ result: unknown }>(
      "select public.synthetic_tuple_reference($1,$2,$3,$4,$5) result",
      [from, until, beforeStart, beforeId, limit],
    )
  ).rows[0].result;
  expect(result).toEqual(original);
  return result;
}
async function restore() {
  await db.exec(
    "update public.web_health_facts f set fact=public.web_extract_fact(r) from public.raw_health_records r where r.id=f.raw_id and f.start_time<'2025-02-01Z'",
  );
}
describe("lossless streaming tuple transport", () => {
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
      "0013_web_tuple_streaming.sql",
    ]) {
      await db.exec(
        readFileSync(resolve("../supabase/migrations", name), "utf8").replace(
          "create extension if not exists pgcrypto;",
          "",
        ),
      );
    }
    const old = readFileSync(
      resolve("../supabase/migrations/0011_web_tuple_fact_reads.sql"),
      "utf8",
    );
    await db.exec(
      old
        .slice(
          old.indexOf("create function public.web_tuple_facts_cursor"),
          old.indexOf("revoke all"),
        )
        .replace(
          "public.web_tuple_facts_cursor",
          "public.synthetic_tuple_reference",
        ),
    );
    await db.exec(
      "revoke all on function public.synthetic_tuple_reference(timestamptz,timestamptz,timestamptz,uuid,integer) from public,anon; grant execute on function public.synthetic_tuple_reference(timestamptz,timestamptz,timestamptz,uuid,integer) to authenticated",
    );
    await db.query("insert into auth.users values($1),($2)", [owner, other]);
    await db.query(
      "insert into public.raw_health_records(user_id,provider,record_type,source_uid,start_time,end_time,payload) select $1,'health_connect','steps','synthetic-wire-'||i,'2025-01-10T00:00Z'::timestamptz+i*interval '1 hour','2025-01-10T00:00Z'::timestamptz+(i+1)*interval '1 hour','{\"metadata\":{},\"count\":100}'::jsonb from generate_series(1,6) i",
      [owner],
    );
    await user(owner);
    await db.query("select public.advance_web_projection($1,$2,25)", [
      from,
      until,
    ]);
  });
  afterAll(async () => {
    await db.close();
  });
  it("matches entire old/new envelopes for 8000 rows, byte-limited UTF8 and microsecond keysets", async () => {
    await db.exec("reset role");
    await db.query(
      "insert into public.raw_health_records(user_id,provider,record_type,source_uid,start_time,payload) select $1,'health_connect','steps','synthetic-stream-'||m||'-'||i,('2025-'||m||'-12T00:00Z')::timestamptz+i*interval '1 microsecond','{}'::jsonb from unnest(array['03','05']) m,generate_series(1,8001) i",
      [owner],
    );
    await db.exec(
      "insert into public.web_health_facts(raw_id,user_id,start_time,received_at,fact) select id,user_id,start_time,received_at,jsonb_build_object('id',id,'kind','steps','provider','health_connect','origin','live','source','','channel','','rank',0,'start',start_time,'end',null,'received',received_at,'value',1,'samples',1,'min',null,'max',null,'sessions','[]'::jsonb,'hourly','[]'::jsonb,'supported',true,'bodyFat',null) from public.raw_health_records where source_uid like 'synthetic-stream-%'",
    );
    await db.query(
      "update public.web_health_facts set fact=fact||jsonb_build_object('source',$1::text) where start_time>='2025-05-01Z'",
      ['雪"\\\n'.repeat(100)],
    );
    await user(owner);
    for (const [start, end, ordinary] of [
      ["2025-03-01Z", "2025-04-01Z", true],
      ["2025-05-01Z", "2025-06-01Z", false],
    ] as const) {
      let beforeStart: string | null = null,
        beforeId: string | null = null,
        more = true;
      const identities = new Set<string>();
      for (let pages = 0; pages < 10 && more; pages++) {
        const args = [start, end, beforeStart, beforeId, 8000];
        const result = (
          await db.query<{ result: unknown; wire_bytes: number }>(
            "select result,octet_length(result::text) wire_bytes from(select public.web_tuple_facts_cursor($1,$2,$3,$4,$5) result) p",
            args,
          )
        ).rows[0];
        const old = (
          await db.query<{ result: unknown }>(
            "select public.synthetic_tuple_reference($1,$2,$3,$4,$5) result",
            args,
          )
        ).rows[0].result;
        expect(result.result).toEqual(old);
        expect(result.wire_bytes).toBeLessThanOrEqual(2097152);
        const decoded = decodeCompactPage(result.result);
        if (pages === 0) {
          expect(decoded.hasMore).toBe(true);
          if (ordinary) expect(decoded.records).toBe(8000);
          else expect(decoded.records).toBeLessThan(8000);
        }
        for (const fact of decoded.facts) {
          expect(identities.has(fact.id)).toBe(false);
          identities.add(fact.id);
        }
        beforeStart = decoded.nextStart;
        beforeId = decoded.nextId;
        more = decoded.hasMore;
      }
      expect(more).toBe(false);
      expect(identities.size).toBe(8001);
    }
  });
  it("preserves timestamp ties and decreasing microseconds with increasing UUIDs", async () => {
    await db.exec("reset role");
    const identities = [
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000010",
      "00000000-0000-4000-8000-000000000012",
    ];
    for (let i = 0; i < 3; i++)
      await db.query(
        "insert into public.raw_health_records(id,user_id,provider,record_type,source_uid,start_time,payload) values($1,$2,'health_connect','steps',$3,$4,'{\"metadata\":{},\"count\":5}'::jsonb)",
        [
          identities[i],
          owner,
          "synthetic-stream-tie-" + i,
          i < 2 ? "2025-07-01T00:00:00.000002Z" : "2025-07-01T00:00:00.000001Z",
        ],
      );
    await db.exec(
      "insert into public.web_health_facts(raw_id,user_id,start_time,received_at,fact) select id,user_id,start_time,received_at,public.web_extract_fact(r) from public.raw_health_records r where source_uid like 'synthetic-stream-tie-%'",
    );
    await user(owner);
    let start: string | null = null,
      id: string | null = null;
    for (let i = 0; i < 3; i++) {
      const args = ["2025-07-01Z", "2025-08-01Z", start, id, 1];
      const actual = (
        await db.query<{ result: unknown }>(
          "select public.web_tuple_facts_cursor($1,$2,$3,$4,$5) result",
          args,
        )
      ).rows[0].result;
      const original = (
        await db.query<{ result: unknown }>(
          "select public.synthetic_tuple_reference($1,$2,$3,$4,$5) result",
          args,
        )
      ).rows[0].result;
      expect(actual).toEqual(original);
      const decoded = decodeCompactPage(actual);
      expect(decoded.facts[0].id).toBe(identities[i]);
      expect(decoded.hasMore).toBe(i < 2);
      start = decoded.nextStart;
      id = decoded.nextId;
    }
  });
  it("preserves every field including nested arrays, nulls, false and zeros", async () => {
    await user(owner);
    const original = {
      id: owner,
      kind: "sleep",
      provider: "samsung_health",
      origin: "historical",
      source: "synthetic-export",
      channel: "synthetic-watch",
      rank: 0,
      start: "2025-01-01T00:00:00.000001Z",
      end: null,
      received: "2025-01-02T00:00:00Z",
      value: 0,
      samples: 0,
      min: null,
      max: 0,
      bodyFat: null,
      supported: false,
      sessions: [
        {
          start: "2025-01-01T00:00:00Z",
          end: "2025-01-01T01:00:00Z",
          minutes: 60,
          stages: { deep: 0, light: 60 },
          durationBasis: "known_stages",
          category: "sleep",
        },
      ],
      hourly: [
        {
          start: "2025-01-01T00:00:00Z",
          end: "2025-01-01T01:00:00Z",
          mean: 0,
          count: 0,
        },
      ],
    };
    const tuple = (
      await db.query<{ result: unknown }>(
        "select public.web_tuple_fact_v2($1::jsonb) result",
        [JSON.stringify(original)],
      )
    ).rows[0].result;
    expect(Array.isArray(tuple) && tuple.length).toBe(18);
    expect(
      decodeCompactPage({
        wire_version: 2,
        records: [tuple],
        has_more: false,
        next_start: null,
        next_id: null,
      }).facts,
    ).toEqual([original]);
  });
  it("decodes exactly the original facts with disjoint canonical keyset pages", async () => {
    await user(owner);
    const first = decodeCompactPage(await read(null, null, 2));
    expect(first.hasMore).toBe(true);
    expect(first.facts).toHaveLength(2);
    const second = decodeCompactPage(
      await read(first.nextStart, first.nextId, 2),
    );
    const third = decodeCompactPage(
      await read(second.nextStart, second.nextId, 2),
    );
    expect(third.hasMore).toBe(false);
    const plain = (
      await db.query<{ result: unknown[] }>(
        "select public.web_facts_cursor($1,$2,null,null,2000) result",
        [from, until],
      )
    ).rows[0].result;
    expect([...first.facts, ...second.facts, ...third.facts]).toEqual(plain);
    expect(
      new Set(
        [...first.facts, ...second.facts, ...third.facts].map((row) => row.id),
      ).size,
    ).toBe(6);
  });
  it("incomplete original source fields remain quarantined after compression", async () => {
    await user(owner);
    await db.exec(
      "update public.web_health_facts set fact=fact-'source' where raw_id=(select raw_id from public.web_health_facts where start_time<'2025-02-01Z' order by start_time desc limit 1)",
    );
    const page = decodeCompactPage(await read());
    expect(page.records).toBe(6);
    expect(page.invalid).toBe(1);
    expect(page.facts).toHaveLength(5);
    await restore();
  });
  it("byte budget creates short incomplete pages without skipping any identity", async () => {
    await user(owner);
    await db.exec(
      "update public.web_health_facts set fact=fact||jsonb_build_object('source',repeat('x',1200000)) where raw_id in(select raw_id from public.web_health_facts where start_time<'2025-02-01Z' order by start_time desc limit 2)",
    );
    const firstWire = await read();
    expect(Buffer.byteLength(JSON.stringify(firstWire))).toBeLessThanOrEqual(
      2097152,
    );
    const first = decodeCompactPage(firstWire);
    expect(first.records).toBe(1);
    expect(first.hasMore).toBe(true);
    const second = decodeCompactPage(await read(first.nextStart, first.nextId));
    expect(second.records).toBe(5);
    expect(second.hasMore).toBe(false);
    expect(
      new Set([...first.facts, ...second.facts].map((row) => row.id)).size,
    ).toBe(6);
    await restore();
  });
  it("full JSON envelope stays within byte limits for UTF8 and escaped strings", async () => {
    await user(owner);
    await db.query(
      "update public.web_health_facts set fact=fact||jsonb_build_object('source',$1::text) where raw_id in(select raw_id from public.web_health_facts where start_time<'2025-02-01Z' order by start_time desc limit 2)",
      ['雪"\\\n'.repeat(150000)],
    );
    const result = (
      await db.query<{ result: unknown; wire_bytes: number }>(
        "select result,octet_length(result::text) wire_bytes from (select public.web_tuple_facts_cursor($1,$2,null,null,8000) result) page",
        [from, until],
      )
    ).rows[0];
    expect(result.wire_bytes).toBeLessThanOrEqual(2097152);
    const page = decodeCompactPage(result.result);
    expect(page.records).toBe(1);
    expect(page.hasMore).toBe(true);
    const second = decodeCompactPage(await read(page.nextStart, page.nextId));
    expect(
      new Set([...page.facts, ...second.facts].map((row) => row.id)).size,
    ).toBe(6);
    await restore();
  });
  it("an oversized first fact fails explicitly and is neither deleted nor skipped", async () => {
    await user(owner);
    await db.exec(
      "update public.web_health_facts set fact=fact||jsonb_build_object('source',repeat('x',2200000)) where raw_id=(select raw_id from public.web_health_facts where start_time<'2025-02-01Z' order by start_time desc limit 1)",
    );
    await expect(read()).rejects.toThrow("FACT_TRANSPORT_TOO_LARGE");
    expect(
      (
        await db.query(
          "select raw_id from public.web_health_facts where start_time<'2025-02-01Z'",
        )
      ).rows,
    ).toHaveLength(6);
    expect(
      (
        await db.query(
          "select id from public.raw_health_records where start_time<'2025-02-01Z'",
        )
      ).rows,
    ).toHaveLength(6);
    await restore();
  });
  it("raw revisions and tombstones are excluded immediately", async () => {
    await user(owner);
    await db.exec(
      "update public.raw_health_records set received_at=received_at+interval '1 second' where source_uid='synthetic-wire-1'",
    );
    expect(decodeCompactPage(await read()).records).toBe(5);
    await db.exec(
      "update public.raw_health_records set deleted=true where source_uid='synthetic-wire-2'",
    );
    expect(decodeCompactPage(await read()).records).toBe(4);
  });
  it("enforces owner and anonymous isolation plus cursor/row/range bounds", async () => {
    await user(other);
    expect(decodeCompactPage(await read()).records).toBe(0);
    await expect(read(null, null, 8001)).rejects.toThrow();
    await expect(read("2025-01-01T00:00Z", null)).rejects.toThrow();
    await expect(
      db.query("select public.web_tuple_facts_cursor(null,$1)", [until]),
    ).rejects.toThrow();
    await db.exec("reset role;set role anon");
    await expect(read()).rejects.toThrow();
  });
});

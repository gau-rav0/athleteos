import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";

// Invented records only. Never connect this diagnostic to a live database.
const db = new PGlite();
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
try {
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  for (const name of readdirSync(resolve("../supabase/migrations"))
    .filter((n) => /^00(0[1-9]|1[0-4])_.*\.sql$/.test(n))
    .sort()) {
    await db.exec(
      readFileSync(resolve("../supabase/migrations", name), "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  }
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  await db.query(
    "insert into public.raw_health_records(user_id,provider,record_type,source_uid,start_time,payload) select $1,'health_connect','steps','invented-plan-'||i,'2025-01-01Z'::timestamptz+i*interval '5 minutes','{}'::jsonb from generate_series(1,72000) i",
    [owner],
  );
  await db.query(
    "insert into public.raw_health_records(user_id,provider,record_type,source_uid,start_time,payload) select $1,'health_connect','steps','invented-other-'||i,'2025-01-01Z'::timestamptz+i*interval '5 minutes','{}'::jsonb from generate_series(1,4000) i",
    [other],
  );
  await db.exec(
    "insert into public.web_health_facts(raw_id,user_id,start_time,received_at,fact) select id,user_id,start_time,received_at,'{}'::jsonb from public.raw_health_records; analyze public.raw_health_records; analyze public.web_health_facts;",
  );
  const cursor = (
    await db.query(
      "select start_time::text t,id::text id from public.raw_health_records where user_id=$1 and source_uid='invented-plan-12000'",
      [owner],
    )
  ).rows[0];
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  await db.exec("set role authenticated");
  const predicate = `select f.fact,f.start_time,f.raw_id from public.web_health_facts f where f.user_id=$1 and f.extractor_version=1 and f.start_time>=$2 and f.start_time<$3 and CURSOR and coalesce((select not r.deleted and f.received_at=r.received_at from public.raw_health_records r where r.id=f.raw_id and r.user_id=$1),false) order by f.start_time desc,f.raw_id desc limit $6`;
  await db.exec(
    "prepare nullable(uuid,timestamptz,timestamptz,timestamptz,uuid,integer) as " +
      predicate.replace(
        "CURSOR",
        "($4 is null or (f.start_time,f.raw_id)<($4,$5))",
      ),
  );
  await db.exec(
    "prepare direct(uuid,timestamptz,timestamptz,timestamptz,uuid,integer) as " +
      predicate.replace("CURSOR", "(f.start_time,f.raw_id)<($4,$5)"),
  );
  // Only fixed invented fixture values enter EXECUTE; no private input exists.
  const args = `'${owner}','2025-01-01Z','2026-01-01Z','${cursor.t}','${cursor.id}',8001`;
  let reference;
  for (const mode of ["force_custom_plan", "force_generic_plan"]) {
    await db.exec(`set plan_cache_mode=${mode}`);
    for (const query of ["nullable", "direct"]) {
      const rows = (await db.query(`execute ${query}(${args})`)).rows;
      if (reference) assert.deepEqual(rows, reference);
      else reference = rows;
      const plan = (
        await db.query(
          `explain (analyze,buffers,format json) execute ${query}(${args})`,
        )
      ).rows[0]["QUERY PLAN"][0];
      const nodes = [];
      function walk(node) {
        nodes.push({
          node: node["Node Type"],
          index: node["Index Name"] ?? null,
          rows: node["Actual Rows"],
          loops: node["Actual Loops"],
          removed: node["Rows Removed by Filter"] ?? 0,
          cursorIndexed: /ROW\(/.test(node["Index Cond"] ?? ""),
          buffers: node["Shared Hit Blocks"] ?? 0,
        });
        for (const child of node.Plans ?? []) walk(child);
      }
      walk(plan.Plan);
      const scan = nodes.find((node) => node.index === "web_facts_user_start");
      assert.ok(scan, "invented fixture should use its owner/time index");
      if (query === "direct" || mode === "force_custom_plan") {
        assert.equal(scan.cursorIndexed, true);
        assert.equal(scan.removed, 0);
      } else {
        assert.equal(scan.cursorIndexed, false);
        assert.equal(scan.removed, 60001);
      }
      console.log(
        JSON.stringify({ mode, query, ms: plan["Execution Time"], nodes }),
      );
    }
  }
  await db.exec("reset role");
  const previous = readFileSync(
    resolve("../supabase/migrations/0014_web_tuple_timing.sql"),
    "utf8",
  );
  await db.exec(
    previous.replace(
      "public.web_tuple_facts_cursor",
      "public.synthetic_cursor_reference",
    ),
  );
  await db.exec(
    "revoke all on function public.synthetic_cursor_reference(timestamptz,timestamptz,timestamptz,uuid,integer) from public,anon;grant execute on function public.synthetic_cursor_reference(timestamptz,timestamptz,timestamptz,uuid,integer) to authenticated",
  );
  await db.exec(
    readFileSync(
      resolve("../supabase/migrations/0015_web_indexed_tuple_cursor.sql"),
      "utf8",
    ),
  );
  await db.exec(
    "set role authenticated;set plan_cache_mode=force_generic_plan",
  );
  let beforeStart = null,
    beforeId = null,
    count = 0,
    pages = 0;
  do {
    const values = ["2025-01-01Z", "2026-01-01Z", beforeStart, beforeId, 8000];
    const old = (
      await db.query(
        "select public.synthetic_cursor_reference($1,$2,$3,$4,$5) result",
        values,
      )
    ).rows[0].result;
    const current = (
      await db.query(
        "select public.web_tuple_facts_cursor($1,$2,$3,$4,$5) result",
        values,
      )
    ).rows[0].result;
    const { sql_ms: oldMs, ...oldEnvelope } = old;
    const { sql_ms: currentMs, ...currentEnvelope } = current;
    assert.ok(Number.isFinite(oldMs) && Number.isFinite(currentMs));
    assert.deepEqual(currentEnvelope, oldEnvelope);
    count += current.records.length;
    pages++;
    assert.ok(pages <= 10, "bounded invented continuation must terminate");
    beforeStart = current.next_start;
    beforeId = current.next_id;
    if (!current.has_more) break;
  } while (true);
  assert.equal(count, 72000);
  console.log(
    JSON.stringify({
      inventedRows: count,
      pages,
      envelopesIdentical: true,
      productionConnection: false,
    }),
  );
} finally {
  await db.close();
}

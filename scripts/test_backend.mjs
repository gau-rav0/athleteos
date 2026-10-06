// Real PostgreSQL execution via PGlite. Synthetic fixtures; no remote Supabase access.
// Install @electric-sql/pglite@0.3.14 outside the repository and set ATHLETEOS_PGLITE_MODULE.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const modulePath = process.env.ATHLETEOS_PGLITE_MODULE;
if (!modulePath) throw new Error('ATHLETEOS_PGLITE_MODULE_REQUIRED');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    insert into auth.users values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
  `);
  const first = await readFile(new URL('../supabase/migrations/0001_phase1.sql', import.meta.url), 'utf8');
  // PGlite lacks the optional pgcrypto extension; PG's built-in gen_random_uuid remains available.
  await db.exec(first.replace(/create extension if not exists pgcrypto;/i, ''));
  await db.exec(await readFile(new URL('../supabase/migrations/0002_phase1_ingestion.sql', import.meta.url), 'utf8'));
  await db.exec(`set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';`);
  const device = { device_uid: 'synthetic-device', platform: 'android', app_version: 'synthetic' };
  const record = { provider: 'health_connect', record_type: 'steps', source_uid: 'synthetic-record', schema_version: 1,
    payload: { count: 1 }, start_time: '2025-01-01T00:00:00Z', source_zone_offset: '+05:30', end_zone_offset: '+06:00',
    device_provenance: { model: 'synthetic-watch' }, ingestion_origin: 'live', deleted: false,
    client_revision: 1, observed_at: '2025-01-01T01:00:00Z' };
  const ingest = async (records, deviceValue = device, runs = []) => (await db.query(
    'select public.ingest_health_batch($1::jsonb,$2::jsonb,$3::jsonb) as result', [JSON.stringify(deviceValue), JSON.stringify(records), JSON.stringify(runs)])).rows[0].result;
  assert.equal((await ingest([record])).accepted, 1);
  await ingest([record]);
  assert.equal((await db.query('select * from raw_health_records')).rows.length, 1);
  await ingest([{ ...record, client_revision: 2, payload: { count: 2 } }]);
  await ingest([record]);
  assert.deepEqual((await db.query('select payload from raw_health_records')).rows[0].payload, { count: 2 });
  await ingest([{ ...record, client_revision: 3, deleted: true }]);
  assert.equal((await db.query('select deleted from raw_health_records')).rows[0].deleted, true);
  await ingest([{ ...record, ingestion_origin: 'historical', client_revision: 99 }], { ...device, device_uid: 'synthetic-import' });
  assert.equal((await db.query('select deleted from raw_health_records')).rows[0].deleted, true);
  const saved = (await db.query('select * from raw_health_records')).rows[0];
  assert.equal(saved.source_zone_offset, '+05:30'); assert.equal(saved.end_zone_offset, '+06:00');
  assert.equal(saved.device_provenance.model, 'synthetic-watch');
  await ingest([{ ...record, provider: 'samsung_health', ingestion_origin: 'historical' }], { ...device, device_uid: 'synthetic-import' });
  assert.equal((await db.query('select * from raw_health_records')).rows.length, 2);
  await ingest([{ ...record, provider: 'samsung_health', client_revision: 1, payload: { count: 3 } }]);
  assert.deepEqual((await db.query("select payload from raw_health_records where provider='samsung_health'")).rows[0].payload, { count: 3 });
  const run = { id: '00000000-0000-4000-8000-000000000010', started_at: '2025-01-01T00:00:00Z', finished_at: '2025-01-01T00:01:00Z', status: 'SUCCESS', records_read: 1, records_failed: 0 };
  await ingest([], device, [run]); await ingest([], device, [run]);
  assert.equal((await db.query('select * from sync_runs')).rows.length, 1);
  await assert.rejects(ingest(Array.from({ length: 501 }, (_, i) => ({ ...record, source_uid: `synthetic-${i}` }))));
  await assert.rejects(ingest([{ ...record, source_uid: 'synthetic-rollback' }, { ...record, source_uid: 'synthetic-invalid', provider: 'invalid' }]));
  assert.equal((await db.query("select * from raw_health_records where source_uid='synthetic-rollback'")).rows.length, 0);
  const goal = { ...record, provider: 'samsung_health', ingestion_origin: 'historical', record_type: 'training_load_goal', source_uid: 'synthetic-goal', start_time: null };
  await ingest([goal]);
  assert.equal((await db.query("select start_time from raw_health_records where source_uid='synthetic-goal'")).rows[0].start_time, null);
  await assert.rejects(ingest([{ ...goal, record_type: 'steps', source_uid: 'synthetic-undated-steps' }]));
  await assert.rejects(ingest([{ ...record, provider: 'samsung_health', record_type: 'hrv_rmssd', source_uid: 'synthetic-fabricated-hrv' }]));
  await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';");
  assert.equal((await db.query('select * from raw_health_records')).rows.length, 0);
  assert.equal((await db.query('select * from devices')).rows.length, 0);
  assert.equal((await db.query('select * from sync_runs')).rows.length, 0);
  await assert.rejects(db.query("insert into devices(user_id,device_uid) values('00000000-0000-4000-8000-000000000001','forged-device')"));
  await db.exec("set request.jwt.claim.sub='';"); await assert.rejects(ingest([record]));
  await db.exec('reset role; set role anon;'); await assert.rejects(ingest([record]));
  console.log('PASS: migrations, RLS isolation, atomic rollback, auth ownership, duplicate ingestion, stale replay, updates, tombstones, provenance, historical overlap, independent providers, run idempotency, 500 limit.');
  console.log('NOTE: pgcrypto extension installation skipped in embedded PostgreSQL; verify it during Supabase deployment.');
} finally { await db.close(); }

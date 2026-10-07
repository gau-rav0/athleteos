-- Match the compact JSON byte limit enforced by Android and the Edge Function.
-- jsonb::text inserts spaces outside strings; those must not count as payload data.
-- Match complete quoted strings first so whitespace and escapes inside them survive.
create or replace function public.health_payload_wire_bytes(p_payload jsonb)
returns integer
language sql immutable strict parallel safe
set search_path = public, pg_temp
as $$
  select octet_length(regexp_replace(p_payload::text, '("(?:[^"\\]|\\.)*")| +', '\1', 'g'));
$$;
revoke all on function public.health_payload_wire_bytes(jsonb) from public, anon;
grant execute on function public.health_payload_wire_bytes(jsonb) to authenticated;

create or replace function public.ingest_health_batch(p_device jsonb, p_records jsonb, p_runs jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_device text := p_device->>'device_uid';
  v_record jsonb;
  v_run jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_records is null or p_runs is null or jsonb_typeof(p_device) is distinct from 'object'
     or jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 500
     or jsonb_typeof(p_runs) <> 'array' or jsonb_array_length(p_runs) > 100
     or v_device is null or length(v_device) not between 1 and 128 then
    raise exception 'INVALID_BATCH';
  end if;
  insert into public.devices(user_id, device_uid, platform, model, app_version)
    values(v_user, v_device, coalesce(p_device->>'platform', 'android'), p_device->>'model', p_device->>'app_version')
    on conflict(user_id, device_uid) do update set
      model = excluded.model, app_version = excluded.app_version, updated_at = now();

  for v_record in select value from jsonb_array_elements(p_records) loop
    if v_record ? 'user_id' or not (v_record ?& array['provider', 'record_type', 'source_uid', 'payload', 'client_revision', 'observed_at'])
       or (v_record->>'client_revision')::bigint < 1
       or (v_record->>'record_type' = 'hrv_rmssd' and v_record->>'provider' <> 'health_connect')
       or v_record->>'record_type' not in ('steps','sleep','heart_rate','exercise','weight','body_fat','active_calories',
         'total_calories','distance','speed','floors','hrv_rmssd','activity_summary','energy_score','skin_temperature',
         'blood_oxygen','body_composition','user_profile','sleep_stage','steps_daily','pedometer_day_summary','floors_daily','hrv_envelope','respiratory_rate','movement','stress','nap','food_intake','nutrition','water','ecg','mood','heart_health_score','training_load_goal','device_metadata','source_metadata','vendor_raw')
       or ((v_record->>'start_time') is null and not coalesce((v_record->>'deleted')::boolean, false)
           and not (v_record->>'provider' = 'samsung_health' and v_record->>'ingestion_origin' = 'historical'
             and v_record->>'record_type' in ('vendor_raw','training_load_goal','device_metadata','source_metadata','user_profile')))
       or public.health_payload_wire_bytes(v_record->'payload') > 262144 then
      raise exception 'INVALID_RECORD';
    end if;
    insert into public.raw_health_records as existing (
      user_id, provider, record_type, source_uid, source_package, source_device_id, device_provenance,
      start_time, end_time, source_created_at, source_updated_at, source_zone_offset, end_zone_offset,
      schema_version, payload, deleted, ingestion_origin, source_priority, uploader_device_uid, client_revision, observed_at
    ) values (
      v_user, v_record->>'provider', v_record->>'record_type', v_record->>'source_uid',
      v_record->>'source_package', v_record->>'source_device_id', coalesce(v_record->'device_provenance', '{}'::jsonb),
      (v_record->>'start_time')::timestamptz, (v_record->>'end_time')::timestamptz,
      (v_record->>'source_created_at')::timestamptz, (v_record->>'source_updated_at')::timestamptz,
      v_record->>'source_zone_offset', v_record->>'end_zone_offset', coalesce((v_record->>'schema_version')::integer, 1),
      v_record->'payload', coalesce((v_record->>'deleted')::boolean, false), coalesce(v_record->>'ingestion_origin', 'live'),
      coalesce((v_record->>'source_priority')::integer, 0), v_device, (v_record->>'client_revision')::bigint,
      (v_record->>'observed_at')::timestamptz
    ) on conflict(user_id, provider, record_type, source_uid) do update set
      source_package = excluded.source_package, source_device_id = excluded.source_device_id,
      device_provenance = excluded.device_provenance, start_time = excluded.start_time, end_time = excluded.end_time,
      source_created_at = excluded.source_created_at, source_updated_at = excluded.source_updated_at,
      source_zone_offset = excluded.source_zone_offset, end_zone_offset = excluded.end_zone_offset,
      schema_version = excluded.schema_version, payload = excluded.payload, deleted = excluded.deleted,
      ingestion_origin = excluded.ingestion_origin, source_priority = excluded.source_priority,
      uploader_device_uid = excluded.uploader_device_uid, client_revision = excluded.client_revision,
      observed_at = excluded.observed_at, received_at = now()
    where
      -- An offline historical retry must never overwrite an already-observed live record.
      (excluded.ingestion_origin = 'live' or existing.ingestion_origin = 'historical')
      and (
        (excluded.ingestion_origin = 'live' and existing.ingestion_origin = 'historical')
        or (existing.uploader_device_uid = excluded.uploader_device_uid and excluded.client_revision > existing.client_revision
          and (excluded.deleted or excluded.source_updated_at is null or existing.source_updated_at is null
            or excluded.source_updated_at >= existing.source_updated_at))
        or (existing.uploader_device_uid is distinct from excluded.uploader_device_uid
          and excluded.observed_at > existing.observed_at
          and (excluded.source_updated_at is null or existing.source_updated_at is null
            or excluded.source_updated_at >= existing.source_updated_at))
      );
  end loop;

  for v_run in select value from jsonb_array_elements(p_runs) loop
    if v_run ? 'user_id' then raise exception 'INVALID_RUN'; end if;
    insert into public.sync_runs(user_id, device_uid, source, client_run_id, started_at, finished_at, status,
      records_read, records_failed, error_code, app_version, source_results)
    values(v_user, v_device, 'pipeline', (v_run->>'id')::uuid, (v_run->>'started_at')::timestamptz,
      (v_run->>'finished_at')::timestamptz, v_run->>'status', coalesce((v_run->>'records_read')::integer, 0),
      coalesce((v_run->>'records_failed')::integer, 0), v_run->>'error_code', p_device->>'app_version', coalesce(v_run->'source_results', '{}'::jsonb))
    on conflict(user_id, device_uid, client_run_id) do update set
      status = excluded.status, records_failed = excluded.records_failed, error_code = excluded.error_code, source_results = excluded.source_results;
  end loop;
  -- Skipped stale revisions are acknowledged: the server already holds a newer authoritative version.
  return jsonb_build_object('accepted', jsonb_array_length(p_records), 'runs_accepted', jsonb_array_length(p_runs));
end;
$$;

revoke all on function public.ingest_health_batch(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.ingest_health_batch(jsonb, jsonb, jsonb) to authenticated;
grant select, insert, update on public.devices, public.raw_health_records to authenticated;
grant select, insert, update on public.sync_runs to authenticated;

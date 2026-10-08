-- Keep exact raw coverage out of the serving request. Metadata snapshots are
-- owner/timezone scoped and explicitly labeled as-of/stale/unavailable. No raw
-- mutation, trigger, health payload copy, Auth bypass or service-role dependency.
create table public.web_inventory_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  timezone text not null,
  inventory jsonb not null check(jsonb_typeof(inventory)='array'),
  source_watermark timestamptz,
  captured_at timestamptz not null,
  primary key(user_id,timezone)
);
alter table public.web_inventory_snapshots enable row level security;
create policy web_inventory_snapshot_select_own on public.web_inventory_snapshots for select
  using((select auth.uid())=user_id);
create policy web_inventory_snapshot_insert_own on public.web_inventory_snapshots for insert
  with check((select auth.uid())=user_id);
create policy web_inventory_snapshot_update_own on public.web_inventory_snapshots for update
  using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.web_inventory_snapshots from public,anon;
grant select,insert,update on public.web_inventory_snapshots to authenticated;

create function public.read_web_inventory_snapshot(p_timezone text default 'Asia/Kolkata')
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare caller uuid:=auth.uid(); state public.web_inventory_snapshots;
  latest jsonb; watermark timestamptz; missing boolean; expired boolean;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'INVALID_TIMEZONE'; end if;
  select * into state from public.web_inventory_snapshots where user_id=caller and timezone=p_timezone;
  missing:=state.user_id is null;
  expired:=missing or state.captured_at<=now()-interval '5 minutes';
  -- Indexed probes only. Exact raw aggregation belongs exclusively to the worker.
  select received_at into watermark from public.raw_health_records where user_id=caller order by received_at desc limit 1;
  select jsonb_build_object('status',status,'finished',finished_at,'failures',records_failed,'sources',source_results) into latest
    from public.sync_runs where user_id=caller order by finished_at desc nulls last limit 1;
  return jsonb_build_object('inventory',coalesce(state.inventory,'[]'::jsonb),'sync',latest,
    'snapshot',jsonb_build_object('as_of',state.captured_at,
      'stale',expired or watermark is distinct from state.source_watermark,
      'available',not missing,'refresh_required',expired));
end $$;

create function public.refresh_web_inventory_snapshot(p_timezone text default 'Asia/Kolkata')
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare caller uuid:=auth.uid(); state public.web_inventory_snapshots;
  raw_inventory jsonb; watermark timestamptz; captured timestamptz;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'INVALID_TIMEZONE'; end if;
  -- Serialize full scans for the owner even when different tabs select different
  -- timezones. The snapshot key and refresh eligibility remain timezone-specific.
  if not pg_try_advisory_xact_lock(hashtextextended('web-inventory:'||caller::text,0)) then
    return jsonb_build_object('refreshed',false,'busy',true,
      'snapshot',public.read_web_inventory_snapshot(p_timezone)->'snapshot');
  end if;
  -- Recheck after serialization. Multiple tabs cannot trigger duplicate scans.
  select * into state from public.web_inventory_snapshots where user_id=caller and timezone=p_timezone for update;
  if state.user_id is not null and state.captured_at>now()-interval '5 minutes' then
    return jsonb_build_object('refreshed',false,'busy',false,
      'snapshot',public.read_web_inventory_snapshot(p_timezone)->'snapshot');
  end if;
  captured:=clock_timestamp();
  -- Both expressions use one statement visibility snapshot. Counts remain the
  -- existing exact RAW inventory; never replace them with derived fact counts.
  select public.web_inventory(p_timezone)->'inventory',
    (select received_at from public.raw_health_records where user_id=caller order by received_at desc limit 1)
    into raw_inventory,watermark;
  insert into public.web_inventory_snapshots(user_id,timezone,inventory,source_watermark,captured_at)
    values(caller,p_timezone,raw_inventory,watermark,captured)
    on conflict(user_id,timezone) do update set inventory=excluded.inventory,
      source_watermark=excluded.source_watermark,captured_at=excluded.captured_at
    where web_inventory_snapshots.user_id=caller;
  -- A failure/cancellation rolls back replacement. Last validated counts survive.
  return jsonb_build_object('refreshed',true,'busy',false,
    'snapshot',public.read_web_inventory_snapshot(p_timezone)->'snapshot');
end $$;

revoke all on function public.read_web_inventory_snapshot(text),public.refresh_web_inventory_snapshot(text) from public,anon;
grant execute on function public.read_web_inventory_snapshot(text),public.refresh_web_inventory_snapshot(text) to authenticated;

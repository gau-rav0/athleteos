-- Read serving never extracts raw payloads. A separately invoked, caller-owned
-- worker walks metadata with a durable keyset cursor. No raw trigger or raw write.
alter policy health_select_own on public.raw_health_records
  using ((select auth.uid()) = user_id);
create index if not exists sync_runs_web_latest
  on public.sync_runs(user_id,finished_at desc nulls last);

create table public.web_projection_windows (
  user_id uuid not null references auth.users(id) on delete cascade,
  from_time timestamptz not null,
  until_time timestamptz not null,
  cursor_time timestamptz,
  cursor_id uuid,
  source_watermark timestamptz,
  completed boolean not null default false,
  scanned bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key(user_id,from_time,until_time),
  check(until_time>from_time and until_time-from_time<=interval '734 days'),
  check((cursor_time is null)=(cursor_id is null))
);
alter table public.web_projection_windows enable row level security;
create policy web_windows_select_own on public.web_projection_windows for select
  using((select auth.uid())=user_id);
create policy web_windows_insert_own on public.web_projection_windows for insert
  with check((select auth.uid())=user_id);
create policy web_windows_update_own on public.web_projection_windows for update
  using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
grant select,insert,update on public.web_projection_windows to authenticated;

create function public.web_projection_status(p_from timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare caller uuid:=auth.uid(); state public.web_projection_windows; latest timestamptz;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_until<=p_from or p_until-p_from>interval '734 days'
     or p_from is null or p_until is null then raise exception 'INVALID_RANGE'; end if;
  select * into state from public.web_projection_windows
    where user_id=caller and from_time=p_from and until_time=p_until;
  -- Existing user/received index: no full candidate search or payload extraction.
  select received_at into latest from public.raw_health_records
    where user_id=caller order by received_at desc limit 1;
  return jsonb_build_object('remaining',
    state.user_id is null or not state.completed
    or latest is distinct from state.source_watermark
    or state.updated_at<now()-interval '15 minutes');
end $$;

create function public.advance_web_projection(
  p_from timestamptz,p_until timestamptz,p_limit integer default 25
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare caller uuid:=auth.uid(); state public.web_projection_windows;
  latest timestamptz; candidate record; source public.raw_health_records;
  processed integer:=0; seen integer:=0; exhausted boolean:=true;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_limit not between 1 and 50 or p_limit is null or p_from is null or p_until is null
     or p_until<=p_from or p_until-p_from>interval '734 days' then raise exception 'INVALID_RANGE'; end if;
  -- Serialize workers, never reads or the existing ingestion pipeline.
  if not pg_try_advisory_xact_lock(hashtextextended('web-checkpoint:'||caller::text,0)) then
    return jsonb_build_object('processed',0,'scanned',0,'remaining',true,'busy',true);
  end if;
  select received_at into latest from public.raw_health_records
    where user_id=caller order by received_at desc limit 1;
  insert into public.web_projection_windows(user_id,from_time,until_time,source_watermark)
    values(caller,p_from,p_until,latest) on conflict do nothing;
  select * into state from public.web_projection_windows
    where user_id=caller and from_time=p_from and until_time=p_until for update;
  if state.completed then
    if latest is not distinct from state.source_watermark
       and state.updated_at>=now()-interval '15 minutes' then
      return jsonb_build_object('processed',0,'scanned',0,'remaining',false,'busy',false);
    end if;
    state.cursor_time:=null; state.cursor_id:=null; state.completed:=false;
    state.source_watermark:=latest; state.scanned:=0;
  end if;
  -- At most 2,000 metadata rows, with no payload in this result. Already valid
  -- facts advance the cursor without re-extracting dense sample arrays.
  for candidate in
    select r.id,r.start_time,r.received_at,
      coalesce((select f.received_at=r.received_at and f.extractor_version=1
        from public.web_health_facts f where f.raw_id=r.id and f.user_id=caller),false) valid
    from public.raw_health_records r
    where r.user_id=caller and not r.deleted and r.start_time>=p_from and r.start_time<p_until
      and r.record_type in ('steps','steps_daily','pedometer_day_summary','activity_summary','sleep','exercise','weight','body_fat','body_composition','heart_rate','hrv_rmssd','energy_score','blood_oxygen','skin_temperature','respiratory_rate','distance')
      and (state.cursor_time is null or (r.start_time,r.id)<(state.cursor_time,state.cursor_id))
    order by r.start_time desc,r.id desc limit 2000
  loop
    if not candidate.valid and processed>=p_limit then exhausted:=false; exit; end if;
    if not candidate.valid then
      select * into source from public.raw_health_records where id=candidate.id and user_id=caller;
      -- If ingestion changed this row during the scan, use its current revision.
      if not source.deleted and source.start_time>=p_from and source.start_time<p_until then
        insert into public.web_health_facts(raw_id,user_id,start_time,received_at,extractor_version,fact)
          values(source.id,caller,source.start_time,source.received_at,1,public.web_extract_fact(source))
          on conflict(raw_id) do update set start_time=excluded.start_time,
            received_at=excluded.received_at,extractor_version=1,fact=excluded.fact
          where web_health_facts.user_id=caller;
        processed:=processed+1;
      end if;
    end if;
    state.cursor_time:=candidate.start_time; state.cursor_id:=candidate.id; seen:=seen+1;
  end loop;
  -- A full metadata batch may have more rows: completion requires another call.
  state.completed:=exhausted and seen<2000;
  update public.web_projection_windows set cursor_time=state.cursor_time,cursor_id=state.cursor_id,
    source_watermark=state.source_watermark,completed=state.completed,
    scanned=state.scanned+seen,updated_at=now()
    where user_id=caller and from_time=p_from and until_time=p_until;
  -- Cancellation rolls back facts AND cursor. A changed source watermark makes
  -- status partial and the next call starts reconciliation. Periodic rescans
  -- also catch transactions committed behind an earlier visibility snapshot.
  return jsonb_build_object('processed',processed,'scanned',seen,
    'remaining',(public.web_projection_status(p_from,p_until)->>'remaining')::boolean,'busy',false);
end $$;

create function public.web_facts_cursor(
  p_from timestamptz,p_until timestamptz,p_before_start timestamptz default null,
  p_before_id uuid default null,p_limit integer default 2000
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare caller uuid:=auth.uid(); result jsonb;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_from is null or p_until is null or p_until<=p_from or p_until-p_from>interval '734 days'
    or p_limit is null or p_limit not between 1 and 2000
    or (p_before_start is null)<>(p_before_id is null) then raise exception 'INVALID_RANGE'; end if;
  select coalesce(jsonb_agg(fact order by start_time desc,raw_id desc),'[]') into result from (
    select f.fact,f.start_time,f.raw_id from public.web_health_facts f
    where f.user_id=caller and f.extractor_version=1 and f.start_time>=p_from and f.start_time<p_until
      and (p_before_start is null or (f.start_time,f.raw_id)<(p_before_start,p_before_id))
      and coalesce((select not r.deleted and f.received_at=r.received_at
        from public.raw_health_records r where r.id=f.raw_id and r.user_id=caller),false)
    order by f.start_time desc,f.raw_id desc limit p_limit
  ) page;
  return result;
end $$;

-- Inventory remains uploaded RAW coverage, not derived-fact coverage. Capture
-- auth.uid once and let the optimized ownership policy reuse its initplan.
create or replace function public.web_inventory(p_timezone text default 'Asia/Kolkata')
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare caller uuid:=auth.uid(); inventory jsonb; latest jsonb;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'INVALID_TIMEZONE'; end if;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into inventory from (
    select provider,record_type,count(*) records,count(distinct (start_time at time zone p_timezone)::date) observed_days,
      min(start_time) first_at,max(start_time) last_at,max(received_at) received_at,count(*) filter(where ingestion_origin='historical') historical_records
    from public.raw_health_records where user_id=caller and not deleted group by provider,record_type
  ) t;
  select jsonb_build_object('status',status,'finished',finished_at,'failures',records_failed,'sources',source_results) into latest
    from public.sync_runs where user_id=caller order by finished_at desc nulls last limit 1;
  return jsonb_build_object('inventory',inventory,'sync',latest);
end $$;

revoke all on function public.web_projection_status(timestamptz,timestamptz),
  public.advance_web_projection(timestamptz,timestamptz,integer),
  public.web_facts_cursor(timestamptz,timestamptz,timestamptz,uuid,integer) from public,anon;
grant execute on function public.web_projection_status(timestamptz,timestamptz),
  public.advance_web_projection(timestamptz,timestamptz,integer),
  public.web_facts_cursor(timestamptz,timestamptz,timestamptz,uuid,integer) to authenticated;

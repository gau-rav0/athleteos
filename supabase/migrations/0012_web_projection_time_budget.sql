-- Bound heterogeneous projection work without discarding or skipping records.
-- Existing invocation/ACL/RLS and source-ingestion behavior remain unchanged.
create or replace function public.advance_web_projection(
  p_from timestamptz,p_until timestamptz,p_limit integer default 25
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare processing_deadline timestamptz:=clock_timestamp()+interval '4 seconds';
  caller uuid:=auth.uid(); state public.web_projection_windows;
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
    -- A single lookup/extraction cannot be preempted safely mid-record. Once a
    -- candidate has been consumed, stop BEFORE the next one at the time budget.
    -- This commits the exact prefix and avoids zero-progress retry loops.
    if seen>0 and clock_timestamp()>=processing_deadline then
      exhausted:=false; exit;
    end if;
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

-- Serialize only per-owner dashboard projection work. Ingestion is unchanged.
-- Indexed cache probes and a materialized bounded batch avoid broad raw/cache joins.
create or replace function public.refresh_web_facts(
  p_from timestamptz,p_until timestamptz,p_limit integer default 1000
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare processed integer; remaining boolean; caller uuid := auth.uid();
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_limit not between 1 and 1000 or p_until<=p_from
     or p_until-p_from>interval '734 days' then raise exception 'INVALID_RANGE'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('web-facts:'||caller::text,0)) then
    return jsonb_build_object('processed',0,'remaining',true);
  end if;
  with candidates as materialized (
    select r.* from public.raw_health_records r
    where r.user_id=caller and not r.deleted and r.start_time>=p_from and r.start_time<p_until
      and r.record_type in ('steps','steps_daily','pedometer_day_summary','activity_summary','sleep','exercise','weight','body_fat','body_composition','heart_rate','hrv_rmssd','energy_score','blood_oxygen','skin_temperature','respiratory_rate','distance')
      and not coalesce((select f.received_at=r.received_at and f.extractor_version=1
        from public.web_health_facts f where f.raw_id=r.id and f.user_id=caller limit 1),false)
    order by r.start_time desc,r.id limit p_limit
  ), written as (
    insert into public.web_health_facts(raw_id,user_id,start_time,received_at,extractor_version,fact)
    select id,user_id,start_time,received_at,1,public.web_extract_fact(c::public.raw_health_records)
    from candidates c
    on conflict(raw_id) do update set received_at=excluded.received_at,extractor_version=1,
      fact=excluded.fact,start_time=excluded.start_time
    where web_health_facts.user_id=caller returning 1
  ) select count(*) into processed from written;
  select exists(select 1 from public.raw_health_records r
    where r.user_id=caller and not r.deleted and r.start_time>=p_from and r.start_time<p_until
      and r.record_type in ('steps','steps_daily','pedometer_day_summary','activity_summary','sleep','exercise','weight','body_fat','body_composition','heart_rate','hrv_rmssd','energy_score','blood_oxygen','skin_temperature','respiratory_rate','distance')
      and not coalesce((select f.received_at=r.received_at and f.extractor_version=1
        from public.web_health_facts f where f.raw_id=r.id and f.user_id=caller limit 1),false))
    into remaining;
  return jsonb_build_object('processed',processed,'remaining',remaining);
end $$;

-- Experimental web preview. Additive projections; raw ingestion is unchanged.
-- All access uses caller ownership and RLS. No security-definer functions.
create table public.web_health_facts (
  raw_id uuid primary key references public.raw_health_records(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  start_time timestamptz not null,
  received_at timestamptz not null,
  extractor_version integer not null default 1,
  fact jsonb not null
);
alter table public.web_health_facts enable row level security;
create policy web_facts_select_own on public.web_health_facts for select using(auth.uid()=user_id);
create policy web_facts_insert_own on public.web_health_facts for insert with check(auth.uid()=user_id);
create policy web_facts_update_own on public.web_health_facts for update using(auth.uid()=user_id) with check(auth.uid()=user_id);
grant select,insert,update on public.web_health_facts to authenticated;
create index web_facts_user_start on public.web_health_facts(user_id,start_time,raw_id);
create index raw_web_refresh on public.raw_health_records(user_id,start_time,id) where not deleted;

create function public.web_number(p jsonb) returns double precision
language plpgsql immutable strict set search_path=public,pg_temp as $$
declare n double precision;
begin
  if jsonb_typeof(p) not in ('number','string') then return null; end if;
  if (p#>>'{}') !~ '^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$' then return null; end if;
  n := (p#>>'{}')::double precision;
  if n in ('Infinity'::double precision,'-Infinity'::double precision,'NaN'::double precision) then return null; end if;
  return n;
exception when others then return null;
end $$;
create function public.web_instant(p text) returns timestamptz
language plpgsql immutable strict set search_path=public,pg_temp as $$
begin
  if p !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then return null; end if;
  return p::timestamptz;
exception when others then return null;
end $$;
create function public.web_duration_minutes(p text) returns double precision
language plpgsql immutable strict set search_path=public,pg_temp as $$
begin
  if p !~ '^P([0-9]+D)?T([0-9]+H)?([0-9]+M)?([0-9]+(\.[0-9]+)?S)?$' then return null; end if;
  return extract(epoch from p::interval)/60.0;
exception when others then return null;
end $$;

-- Explicit v1 schema extractor. Arbitrary vendor fields are never interpreted.
create function public.web_extract_fact(r public.raw_health_records) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare
  p jsonb:=r.payload; f jsonb; value double precision; n bigint; lo double precision; hi double precision;
  buckets jsonb:='[]'; sessions jsonb:='[]'; items jsonb; s jsonb; stages jsonb;
  st timestamptz; en timestamptz; mins double precision; stage_totals jsonb;
  rank integer:=r.source_priority; channel text; supported boolean:=true;
begin
  if r.deleted or r.start_time is null then return null; end if;
  if r.provider='health_connect' and p ? 'metadata' then f:=p;
  elsif r.provider='samsung_health' and p->>'sdk_version'='1.1.0' and jsonb_typeof(p->'fields')='object' then f:=p->'fields';
  elsif r.ingestion_origin='historical' and jsonb_typeof(p->'raw')='object' then f:=p->'raw';
  else f:='{}'; supported:=false; end if;
  channel:=md5(r.provider||':'||coalesce(r.source_package,'unknown')||':'||coalesce(r.source_device_id,r.device_provenance::text));
  if r.record_type='steps' then
    value:=public.web_number(f->'count');
    rank:=case when r.device_provenance->>'type'='1' or lower(r.device_provenance->>'model') like '%watch%' then 300
               when r.device_provenance->>'type'='2' then 200 else 100 end;
  elsif r.record_type in ('steps_daily','pedometer_day_summary','activity_summary') then
    value:=coalesce(public.web_number(f->'step_count'),public.web_number(f->'count'));
    rank:=case r.record_type when 'activity_summary' then 600 when 'steps_daily' then 500 else 400 end;
  elsif r.record_type in ('weight','body_composition') then
    value:=case when r.provider='health_connect' then public.web_number(f->'kilograms') else public.web_number(f->'weight') end;
  elsif r.record_type='body_fat' then value:=coalesce(public.web_number(f->'percentage'),public.web_number(f->'body_fat'));
  elsif r.record_type='hrv_rmssd' and r.provider='health_connect' then value:=public.web_number(f->'rmssd_milliseconds');
  elsif r.record_type='energy_score' then value:=public.web_number(f->'total_score');
  elsif r.record_type='blood_oxygen' then value:=coalesce(public.web_number(f->'spo2'),public.web_number(f->'spo2_value'));
  elsif r.record_type='skin_temperature' then value:=public.web_number(f->'temperature');
  elsif r.record_type='respiratory_rate' then value:=public.web_number(f->'respiratory_rate');
  elsif r.record_type='distance' then value:=public.web_number(f->'metres');
  elsif r.record_type in ('sleep','exercise') then
    items:=case when r.provider='samsung_health' and r.ingestion_origin='live' then f->'sessions'
                else jsonb_build_array(jsonb_build_object('startTime',r.start_time,'endTime',r.end_time,'stages',f->'stages')) end;
    if jsonb_typeof(items)='array' and jsonb_array_length(items)<=1000 then
      for s in select x from jsonb_array_elements(items) x loop
        st:=public.web_instant(s->>'startTime'); en:=public.web_instant(s->>'endTime');
        if st is null or en is null or en<=st then continue; end if;
        mins:=coalesce(public.web_duration_minutes(s->>'duration'),extract(epoch from en-st)/60.0);
        stages:=case when jsonb_typeof(s->'stages')='array' then s->'stages' else '[]'::jsonb end;
        select coalesce(jsonb_object_agg(kind,total),'{}') into stage_totals from (
          select kind,sum(duration) total from (
            select case x->>'stage' when '4' then 'light' when '5' then 'deep' when '6' then 'rem'
                   when '2' then 'asleep_unspecified' when '1' then 'awake' when '3' then 'awake' when '7' then 'awake'
                   when 'LIGHT' then 'light' when 'DEEP' then 'deep' when 'REM' then 'rem' when 'AWAKE' then 'awake' else 'unknown' end kind,
                   greatest(0,extract(epoch from public.web_instant(coalesce(x->>'endTime',x->>'end_time'))-public.web_instant(coalesce(x->>'startTime',x->>'start_time')))/60.0) duration
            from jsonb_array_elements(stages) x
          ) parts where duration is not null group by kind
        ) totals;
        if r.record_type='sleep' and r.provider='health_connect' and stage_totals ?| array['light','deep','rem','asleep_unspecified'] then
          select sum(public.web_number(v)) into mins from jsonb_each(stage_totals) e(k,v) where k in ('light','deep','rem','asleep_unspecified');
        end if;
        if mins<0 or mins>extract(epoch from en-st)/60.0+1 then continue; end if;
        sessions:=sessions||jsonb_build_array(jsonb_build_object('start',st,'end',en,'minutes',mins,'stages',stage_totals,
          'durationBasis',case when r.record_type='sleep' and r.provider='health_connect' and stage_totals ?| array['light','deep','rem','asleep_unspecified'] then 'known_stages' when s ? 'duration' then 'vendor_duration' else 'interval' end,
          'category',case when r.record_type='exercise' then coalesce(s->>'exerciseType',f->>'exercise_type','OTHER') else 'sleep' end));
      end loop;
    end if;
  elsif r.record_type='heart_rate' then
    if r.provider='health_connect' then
      items:=case when jsonb_typeof(f->'samples')='array' then f->'samples' else '[]'::jsonb end;
      select avg(bpm),count(*),min(bpm),max(bpm) into value,n,lo,hi from (
        select public.web_number(x->'beats_per_minute') bpm,public.web_instant(x->>'time') t from jsonb_array_elements(items) x
      ) v where t>=r.start_time and t<=coalesce(r.end_time,r.start_time) and bpm>0 and bpm<1000;
      select coalesce(jsonb_agg(jsonb_build_object('start',bucket_hour,'end',bucket_hour+interval '1 hour','mean',mean,'count',samples) order by bucket_hour),'[]') into buckets from (
        select date_trunc('hour',t,'UTC') bucket_hour,avg(bpm) mean,count(*) samples from (
          select public.web_instant(x->>'time') t,public.web_number(x->'beats_per_minute') bpm from jsonb_array_elements(items) x
        ) v where t>=r.start_time and t<=coalesce(r.end_time,r.start_time) and bpm>0 and bpm<1000 group by 1
      ) h;
    else
      -- Samsung binned HR is vendor-aggregated, not equivalent to HC sample counts.
      value:=public.web_number(f->'heart_rate'); n:=case when value>0 then 1 else 0 end;
      lo:=public.web_number(f->'min'); hi:=public.web_number(f->'max');
    end if;
  else supported:=false;
  end if;
  return jsonb_build_object('id',r.id,'kind',r.record_type,'provider',r.provider,'origin',r.ingestion_origin,
    'source',coalesce(r.source_package,'Unknown source'),'channel',channel,'rank',rank,
    'start',r.start_time,'end',r.end_time,'received',r.received_at,'value',value,'samples',coalesce(n,case when value is null then 0 else 1 end),
    'min',lo,'max',hi,'sessions',sessions,'hourly',buckets,'supported',supported,
    'bodyFat',case when r.record_type='body_composition' then public.web_number(f->'body_fat') else null end);
end $$;

create function public.refresh_web_facts(p_from timestamptz,p_until timestamptz,p_limit integer default 1000)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare processed integer; remaining boolean;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_limit not between 1 and 1000 or p_until<=p_from or p_until-p_from>interval '734 days' then raise exception 'INVALID_RANGE'; end if;
  with candidates as (
    select r.* from public.raw_health_records r left join public.web_health_facts f on f.raw_id=r.id and f.user_id=auth.uid()
    where r.user_id=auth.uid() and not r.deleted and r.start_time>=p_from and r.start_time<p_until
      and r.record_type in ('steps','steps_daily','pedometer_day_summary','activity_summary','sleep','exercise','weight','body_fat','body_composition','heart_rate','hrv_rmssd','energy_score','blood_oxygen','skin_temperature','respiratory_rate','distance')
      and (f.raw_id is null or f.received_at<>r.received_at or f.extractor_version<>1)
    order by r.start_time desc,r.id limit p_limit
  ), written as (
    insert into public.web_health_facts(raw_id,user_id,start_time,received_at,extractor_version,fact)
    select id,user_id,start_time,received_at,1,public.web_extract_fact(c::public.raw_health_records) from candidates c
    on conflict(raw_id) do update set received_at=excluded.received_at,extractor_version=1,fact=excluded.fact,start_time=excluded.start_time
    where web_health_facts.user_id=auth.uid() returning 1
  ) select count(*) into processed from written;
  select exists(select 1 from public.raw_health_records r left join public.web_health_facts f on f.raw_id=r.id and f.user_id=auth.uid()
    where r.user_id=auth.uid() and not r.deleted and r.start_time>=p_from and r.start_time<p_until
      and r.record_type in ('steps','steps_daily','pedometer_day_summary','activity_summary','sleep','exercise','weight','body_fat','body_composition','heart_rate','hrv_rmssd','energy_score','blood_oxygen','skin_temperature','respiratory_rate','distance')
      and (f.raw_id is null or f.received_at<>r.received_at or f.extractor_version<>1)) into remaining;
  return jsonb_build_object('processed',processed,'remaining',remaining);
end $$;

create function public.web_facts_page(p_from timestamptz,p_until timestamptz,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_offset not between 0 and 100000 or p_until<=p_from or p_until-p_from>interval '734 days' then raise exception 'INVALID_RANGE'; end if;
  select coalesce(jsonb_agg(fact order by start_time,raw_id),'[]') into result from (
    select f.fact,f.start_time,f.raw_id from public.web_health_facts f join public.raw_health_records r on r.id=f.raw_id
    where f.user_id=auth.uid() and r.user_id=auth.uid() and not r.deleted and f.received_at=r.received_at and f.extractor_version=1
      and f.start_time>=p_from and f.start_time<p_until order by f.start_time,f.raw_id offset p_offset limit 1000
  ) page;
  return result;
end $$;

create function public.web_inventory(p_timezone text default 'Asia/Kolkata') returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare inventory jsonb; latest jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'INVALID_TIMEZONE'; end if;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into inventory from (
    select provider,record_type,count(*) records,count(distinct (start_time at time zone p_timezone)::date) observed_days,
      min(start_time) first_at,max(start_time) last_at,max(received_at) received_at,count(*) filter(where ingestion_origin='historical') historical_records
    from public.raw_health_records where user_id=auth.uid() and not deleted group by provider,record_type
  ) t;
  select jsonb_build_object('status',status,'finished',finished_at,'failures',records_failed,'sources',source_results) into latest
    from public.sync_runs where user_id=auth.uid() order by finished_at desc nulls last limit 1;
  return jsonb_build_object('inventory',inventory,'sync',latest);
end $$;

revoke all on function public.web_number(jsonb),public.web_instant(text),public.web_duration_minutes(text),public.web_extract_fact(public.raw_health_records),public.refresh_web_facts(timestamptz,timestamptz,integer),public.web_facts_page(timestamptz,timestamptz,integer),public.web_inventory(text) from public,anon;
grant execute on function public.web_number(jsonb),public.web_instant(text),public.web_duration_minutes(text),public.web_extract_fact(public.raw_health_records),public.refresh_web_facts(timestamptz,timestamptz,integer),public.web_facts_page(timestamptz,timestamptz,integer),public.web_inventory(text) to authenticated;

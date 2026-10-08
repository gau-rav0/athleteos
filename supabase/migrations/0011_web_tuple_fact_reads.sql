-- Wire v2 preserves all 18 display-fact fields in a finite positional format.
-- v1 remains unchanged; this transport performs no source/model aggregation.
create function public.web_tuple_fact_v2(p jsonb) returns jsonb
language plpgsql immutable strict security invoker set search_path=public,pg_temp as $$
begin
  if jsonb_typeof(p)<>'object' or not (p ?& array[
    'id','kind','provider','origin','source','channel','rank','start','end',
    'received','value','samples','min','max','sessions','hourly','supported','bodyFat'
  ]) then return jsonb_build_object('transport_invalid',true); end if;
  return jsonb_build_array(p->'id',p->'kind',p->'provider',p->'origin',p->'source',
    p->'channel',p->'rank',p->'start',p->'end',p->'received',p->'value',p->'samples',
    p->'min',p->'max',p->'sessions',p->'hourly',p->'supported',p->'bodyFat');
end $$;
create function public.web_tuple_facts_cursor(
  p_from timestamptz,p_until timestamptz,p_before_start timestamptz default null,
  p_before_id uuid default null,p_limit integer default 8000
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare caller uuid:=auth.uid(); records jsonb; candidate_count integer;
  accepted integer; cursor_time timestamptz; cursor_id uuid; more boolean;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_from is null or p_until is null or p_until<=p_from or p_until-p_from>interval '734 days'
    or p_limit is null or p_limit not between 1 and 8000
    or (p_before_start is null)<>(p_before_id is null) then raise exception 'INVALID_RANGE'; end if;
  with candidates as materialized (
    select f.fact,f.start_time,f.raw_id from public.web_health_facts f
    where f.user_id=caller and f.extractor_version=1 and f.start_time>=p_from and f.start_time<p_until
      and (p_before_start is null or (f.start_time,f.raw_id)<(p_before_start,p_before_id))
      and coalesce((select not r.deleted and f.received_at=r.received_at
        from public.raw_health_records r where r.id=f.raw_id and r.user_id=caller),false)
    order by f.start_time desc,f.raw_id desc limit p_limit+1
  ), encoded as materialized (
    select public.web_tuple_fact_v2(fact) record,start_time,raw_id from candidates
  ), sized as (
    select *,sum(octet_length(record::text)+2) over(order by start_time desc,raw_id desc) wire_bytes,
      row_number() over(order by start_time desc,raw_id desc) ordinal from encoded
  ), page as materialized (
    -- Reserve envelope overhead inside the approximate 2 MiB response budget.
    select * from sized where wire_bytes<=2093056 and ordinal<=p_limit
  ) select coalesce(jsonb_agg(record order by start_time desc,raw_id desc),'[]'),count(*),
    (select count(*) from candidates),
    (select start_time from page order by start_time,raw_id limit 1),
    (select raw_id from page order by start_time,raw_id limit 1)
    into records,accepted,candidate_count,cursor_time,cursor_id from page;
  if candidate_count>0 and accepted=0 then
    -- Surface the blocked record. Never advance the cursor past an oversized fact.
    raise exception 'FACT_TRANSPORT_TOO_LARGE';
  end if;
  more:=candidate_count>accepted;
  return jsonb_build_object('wire_version',2,'records',records,'has_more',more,
    'next_start',case when more then cursor_time else null end,
    'next_id',case when more then cursor_id else null end);
end $$;

revoke all on function public.web_tuple_fact_v2(jsonb),
  public.web_tuple_facts_cursor(timestamptz,timestamptz,timestamptz,uuid,integer) from public,anon;
grant execute on function public.web_tuple_fact_v2(jsonb),
  public.web_tuple_facts_cursor(timestamptz,timestamptz,timestamptz,uuid,integer) to authenticated;

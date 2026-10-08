-- Lossless v2 prefix streaming: encode only accepted records plus lookahead.
-- Limits, RLS, canonical keyset and raw revision/deletion semantics are unchanged.
create or replace function public.web_tuple_facts_cursor(
  p_from timestamptz,p_until timestamptz,p_before_start timestamptz default null,
  p_before_id uuid default null,p_limit integer default 8000
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare caller uuid:=auth.uid(); candidate record; encoded jsonb;
  records jsonb[]:=array[]::jsonb[]; used_bytes integer:=0; accepted integer:=0;
  cursor_time timestamptz; cursor_id uuid; more boolean:=false; record_bytes integer;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_from is null or p_until is null or p_until<=p_from or p_until-p_from>interval '734 days'
    or p_limit is null or p_limit not between 1 and 8000
    or (p_before_start is null)<>(p_before_id is null) then raise exception 'INVALID_RANGE'; end if;
  for candidate in
    select f.fact,f.start_time,f.raw_id from public.web_health_facts f
    where f.user_id=caller and f.extractor_version=1 and f.start_time>=p_from and f.start_time<p_until
      and (p_before_start is null or (f.start_time,f.raw_id)<(p_before_start,p_before_id))
      and coalesce((select not r.deleted and f.received_at=r.received_at
        from public.raw_health_records r where r.id=f.raw_id and r.user_id=caller),false)
    order by f.start_time desc,f.raw_id desc limit p_limit+1
  loop
    if accepted>=p_limit then more:=true; exit; end if;
    encoded:=public.web_tuple_fact_v2(candidate.fact);
    record_bytes:=octet_length(encoded::text)+2;
    if used_bytes+record_bytes>2093056 then
      if accepted=0 then raise exception 'FACT_TRANSPORT_TOO_LARGE'; end if;
      more:=true; exit;
    end if;
    -- PostgreSQL expanded arrays avoid repeated JSONB concatenation/copying.
    records:=array_append(records,encoded);
    used_bytes:=used_bytes+record_bytes; accepted:=accepted+1;
    cursor_time:=candidate.start_time; cursor_id:=candidate.raw_id;
  end loop;
  return jsonb_build_object('wire_version',2,'records',to_jsonb(records),'has_more',more,
    'next_start',case when more then cursor_time else null end,
    'next_id',case when more then cursor_id else null end);
end $$;

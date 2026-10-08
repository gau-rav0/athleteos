-- Bound projection reads to indexed raw-identity probes instead of a full raw join.
-- Keep caller ownership, revision/deletion checks, invoker semantics and grants.
alter policy web_facts_select_own on public.web_health_facts
  using ((select auth.uid()) = user_id);
alter policy web_facts_insert_own on public.web_health_facts
  with check ((select auth.uid()) = user_id);
alter policy web_facts_update_own on public.web_health_facts
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.web_facts_page(
  p_from timestamptz, p_until timestamptz, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker
set search_path=public,pg_temp as $$
declare result jsonb; caller uuid := auth.uid();
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_offset not between 0 and 100000 or p_until<=p_from
     or p_until-p_from>interval '734 days' then raise exception 'INVALID_RANGE'; end if;
  select coalesce(jsonb_agg(fact order by start_time,raw_id),'[]') into result
  from (
    select f.fact,f.start_time,f.raw_id
    from public.web_health_facts f
    where f.user_id=caller and f.extractor_version=1
      and f.start_time>=p_from and f.start_time<p_until
      and coalesce((
        select not r.deleted and f.received_at=r.received_at
        from public.raw_health_records r
        where r.id=f.raw_id and r.user_id=caller limit 1
      ),false)
    order by f.start_time,f.raw_id offset p_offset limit 1000
  ) page;
  return result;
end $$;

-- Synthetic transaction, rolled back. No test rows remain in the user's timeline.
begin;
do $auth$
begin
  perform set_config('request.jwt.claim.sub', (select id::text from auth.users where email_confirmed_at is not null and is_anonymous=false limit 1), true);
end;
$auth$;
set local role authenticated;
do $test$
declare
  envelope jsonb := jsonb_build_object('provider','health_connect','record_type','steps','source_uid','synthetic-dense-regression',
    'start_time','2025-01-01T00:00:00Z','client_revision',1,'observed_at','2025-01-01T00:00:00Z');
  device jsonb := '{"device_uid":"synthetic-dense-regression","platform":"test"}';
  ack jsonb;
begin
  ack := public.ingest_health_batch(device,jsonb_build_array(envelope || jsonb_build_object('payload',jsonb_build_object('value',repeat('x',1834996)))));
  if (ack->>'accepted')::integer <> 1 then raise exception 'DENSE_BOUNDARY_NOT_ACKNOWLEDGED'; end if;
  begin
    perform public.ingest_health_batch(device,jsonb_build_array(envelope || jsonb_build_object('payload',jsonb_build_object('value',repeat('x',1834997)))));
    raise exception 'OVERSIZE_ACCEPTED';
  exception when raise_exception then
    if sqlerrm <> 'INVALID_RECORD' then raise; end if;
  end;
end;
$test$;
rollback;

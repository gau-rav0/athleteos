-- Synthetic fixtures only. Run after migration 0003; no health rows are written.
do $test$
declare
  fixture text := $json${"message":"a b","escaped":"a\" b","values":[1,2,3],"unicode":"λ"}$json$;
  payload jsonb;
begin
  if public.health_payload_wire_bytes(fixture::jsonb) <> octet_length(fixture) then
    raise exception 'STRING_WHITESPACE_OR_ESCAPE_CHANGED';
  end if;
  payload := jsonb_build_object('value', repeat('x', 262132));
  if public.health_payload_wire_bytes(payload) <> 262144 then
    raise exception 'COMPACT_BOUNDARY_REJECTED';
  end if;
  if public.health_payload_wire_bytes(jsonb_build_object('value', repeat('x', 262133))) <= 262144 then
    raise exception 'OVERSIZE_PAYLOAD_ACCEPTED';
  end if;
  payload := jsonb_build_object('samples', (select jsonb_agg(jsonb_build_object('a', 1, 'b', 2)) from generate_series(1, 15000)));
  if octet_length(payload::text) <= 262144 or public.health_payload_wire_bytes(payload) > 262144 then
    raise exception 'JSONB_FORMATTING_REGRESSION';
  end if;
end;
$test$;

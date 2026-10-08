-- CANDIDATE ONLY: NOT a migration, NOT deployed, no proven performance gain.
-- Local warmed 200k-row tests did not choose this index: 464ms vs459ms without.
-- Reconsider only after hosted region/CPU changes and measured plan evidence.
-- Exact uploaded-raw inventory remains unchanged. Read-only profiling found its
-- heap-backed aggregation much slower than cached fact reads. A partial covering
-- metadata index allows index-only scans without including payloads/source IDs.
-- Abort quickly if any lock competes with ingestion; never wait on the phone queue.
set local lock_timeout='3s';
create index if not exists raw_web_inventory_covering
  on public.raw_health_records(user_id,provider,record_type,start_time)
  include(received_at,ingestion_origin) where not deleted;

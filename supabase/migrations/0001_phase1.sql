create extension if not exists pgcrypto;

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_uid text not null,
  platform text not null default 'android',
  model text,
  app_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_uid)
);

create table if not exists public.raw_health_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  record_type text not null,
  source_uid text not null,
  source_package text,
  source_device_id text,
  start_time timestamptz,
  end_time timestamptz,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  source_zone_offset text,
  schema_version integer not null default 1,
  payload jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  received_at timestamptz not null default now(),
  unique (user_id, provider, record_type, source_uid)
);

create index if not exists raw_health_records_user_type_start_idx
  on public.raw_health_records (user_id, record_type, start_time desc);

create index if not exists raw_health_records_user_provider_idx
  on public.raw_health_records (user_id, provider);

create index if not exists raw_health_records_user_received_idx
  on public.raw_health_records (user_id, received_at desc);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_uid text not null,
  source text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  records_read integer not null default 0,
  records_created integer not null default 0,
  records_updated integer not null default 0,
  records_deleted integer not null default 0,
  records_failed integer not null default 0,
  status text not null,
  error_code text,
  app_version text,
  created_at timestamptz not null default now()
);

alter table public.devices enable row level security;
alter table public.raw_health_records enable row level security;
alter table public.sync_runs enable row level security;

create policy "devices_select_own"
  on public.devices for select
  using (auth.uid() = user_id);
create policy "devices_insert_own"
  on public.devices for insert
  with check (auth.uid() = user_id);
create policy "devices_update_own"
  on public.devices for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "health_select_own"
  on public.raw_health_records for select
  using (auth.uid() = user_id);
create policy "health_insert_own"
  on public.raw_health_records for insert
  with check (auth.uid() = user_id);
create policy "health_update_own"
  on public.raw_health_records for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "sync_runs_select_own"
  on public.sync_runs for select
  using (auth.uid() = user_id);
create policy "sync_runs_insert_own"
  on public.sync_runs for insert
  with check (auth.uid() = user_id);

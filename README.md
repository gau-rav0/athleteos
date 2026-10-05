# AthleteOS

AthleteOS is a personal athlete-data platform. Phase 1 focuses only on reliable ingestion and synchronization from Samsung Health and Health Connect into Supabase/Postgres.

## Phase 1 scope

- Android companion app in Kotlin + Jetpack Compose
- Health Connect reads
- Samsung Health Data SDK adapter
- Room-backed durable local queue
- Incremental synchronization
- 72-hour reconciliation on normal sync
- 7-day daily reconciliation
- Supabase Auth + RLS
- Idempotent `sync-batch` backend
- Diagnostics UI

Not in Phase 1: readiness, recovery scoring, training load, AI coaching, correlations, dashboards, or training plans.

## Repository layout

```text
android/
supabase/
docs/
scripts/
```

## Important local dependency

Place the Samsung Health Data SDK AAR at:

```text
android/app/libs/samsung-health-data-api.aar
```

The AAR is intentionally ignored by Git and must not be committed.

## Secrets

Never commit:

- Samsung Health exports
- health CSV/JSON exports
- Supabase service-role keys
- `.env` files
- keystores
- Samsung SDK `.aar` binaries

## Current status

Repository scaffold started. See `docs/PHASE1_PRD.md` for the implementation contract.

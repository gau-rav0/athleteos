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

An experimental five-screen web dashboard preview is available in `web/`, explicitly approved ahead of final ingestion acceptance. See [web setup and deployment](docs/WEB_DASHBOARD.md), [analytics formulas](docs/WEB_ANALYTICS_V0.md), and [privacy boundaries](docs/WEB_SECURITY.md). This preview does not certify Phase 1 completion.

Phase 1 Android/Health Connect, durable Room queue, sync engine, Auth/RLS backend, infrastructure UI and the audited-format offline historical importer are implemented. **Phase 1 is not accepted as complete:** runtime Samsung authorization/reads, private export/overlap validation, Supabase deployment and the physical seven-day reliability gate remain outstanding. Phases 2–6 have not been implemented.

Start with [setup](docs/SETUP_PHASE1.md), [architecture](docs/ARCHITECTURE_PHASE1.md), [Samsung setup](docs/SAMSUNG_SETUP.md), [private historical import](docs/HISTORICAL_IMPORT.md) and [device acceptance checks](docs/DEVICE_VALIDATION.md). See `docs/PHASE1_PRD.md` for the unchanged implementation contract.

# AthleteOS Phase 1 PRD

## Objective

Reliably sync health and fitness data from Samsung Health and Health Connect on Android into Supabase/Postgres with no silent data loss, duplicate inflation, or dependence on manual exports.

## Success criteria

Phase 1 is complete only when:

- Samsung Health is readable from the Android app.
- Health Connect is readable from the Android app.
- New data syncs automatically in the background.
- Edited/finalized records are updated.
- Deleted source records propagate as tombstones.
- Repeated syncs are idempotent.
- Offline records queue locally and upload after connectivity returns.
- Sync failures are visible in diagnostics.
- Manual `Sync now` works.
- Source/device/timestamp provenance is preserved.
- Seven consecutive days pass with no unexplained missing data.

## Architecture

```text
Galaxy Watch6
  -> Samsung Health
  -> Samsung Health Data SDK + Health Connect
  -> AthleteOS Android app
  -> Room raw store + upload queue
  -> authenticated HTTPS
  -> Supabase Edge Function
  -> Postgres
```

## Android stack

- Kotlin
- Jetpack Compose
- Material 3
- Coroutines / Flow
- Room
- WorkManager
- AndroidX Health Connect
- Samsung Health Data SDK
- Retrofit/OkHttp or Ktor
- kotlinx.serialization
- minSdk 29
- JVM 17

Package: `com.athleteos.sync`

## Health Connect MVP data types

Read-only access for:

- Steps
- Sleep sessions
- Heart rate
- Exercise sessions
- Weight
- Body fat where available
- Active calories
- Total calories
- Distance
- Speed
- Floors climbed
- HRV RMSSD when actually present

Request background and historical read permissions where supported. Do not request write permissions.

## Samsung data

Use the current Samsung Health Data SDK, not the deprecated Samsung Health SDK for Android.

Target these types when available:

- Activity Summary
- Energy Score
- Exercise
- Heart Rate
- Sleep
- Steps
- Skin Temperature
- Blood Oxygen
- Body Composition
- Floors Climbed
- User Profile

Missing data is a valid state. Do not synthesize values.

## Local data model

Persist source records locally before network upload.

### RawHealthRecordEntity

- id
- provider
- recordType
- sourceRecordId
- sourcePackage
- sourceDeviceId
- startTimeUtc
- endTimeUtc
- sourceZoneOffset
- sourceCreatedAt
- sourceUpdatedAt
- schemaVersion
- payloadJson
- deleted
- uploadState

### Upload states

- PENDING
- UPLOADING
- SYNCED
- FAILED

### Other local entities

- UploadQueueEntity
- SyncCheckpointEntity
- SyncRunEntity
- DeviceEntity

## Record identity

Server uniqueness:

```text
(user_id, provider, record_type, source_uid)
```

Never deduplicate only by timestamp.

## Sync algorithm

Each regular sync:

1. Read incremental changes.
2. Store changes locally in a transaction.
3. Reconcile trailing 72 hours.
4. Upsert local raw records.
5. Queue unsynced records.
6. Upload in batches of up to 500.
7. Server performs idempotent upsert.
8. Mark successful local records synced.
9. Advance checkpoints only after safe processing.
10. Record a SyncRun.

Also run a trailing 7-day reconciliation once daily.

## Source policy

Preserve Samsung and Health Connect source records independently. Do not destructively deduplicate at ingestion.

Initial preferred-source metadata:

- Sleep: Samsung > Health Connect
- Sleep score: Samsung only
- Energy Score: Samsung only
- Exercise: Samsung > Health Connect
- Heart rate: Samsung Watch > Samsung phone > Health Connect fallback
- Skin temperature: Samsung
- Blood oxygen: Samsung
- HRV: Health Connect only when real RMSSD records are present
- Steps: aggregate/canonical source logic, never watch + phone simple addition

## Background work

Use WorkManager.

- target periodic sync: approximately every 3 hours
- manual sync: supported
- connectivity-aware retry
- boot/restart survival
- exact execution time is not guaranteed by Android

## Backend

Supabase tables:

- devices
- raw_health_records
- sync_runs

Enable RLS. Users may access only rows where `auth.uid() = user_id`.

### sync-batch Edge Function

Endpoint:

```text
POST /functions/v1/sync-batch
```

Max application batch size: 500 records.

Authenticate via Supabase Auth JWT. Derive identity from the verified JWT instead of trusting a client-supplied user id.

## App UI

Only three screens in Phase 1.

### Home

- Samsung Health connection state
- Health Connect connection state
- server state
- last successful sync
- pending records
- latest sync result
- Sync Now button

### Data

Rows for steps, sleep, sleep stages, heart rate, HRV, exercise, weight, body composition, skin temperature, blood oxygen, Energy Score, floors.

Each row shows one of:

- AVAILABLE
- MISSING
- PERMISSION_REQUIRED
- STALE
- UNSUPPORTED

### Diagnostics

- app version
- local device identifier
- Samsung SDK availability
- Samsung permission state
- Health Connect availability
- Health Connect permission state
- last sync start/success
- queue length
- last server response
- failed record count
- Run diagnostics
- Retry failed uploads
- Reconcile last 7 days
- Copy redacted diagnostics

## Security

- HTTPS only
- Supabase Auth
- RLS enabled
- no service-role key in Android
- no passwords/tokens/full health payloads in logs
- keystores and local config ignored by Git
- Samsung exports must never enter the repository

## Validation

Unit tests must cover:

- stable normalized identity
- UTC conversion
- offset preservation
- idempotent duplicate ingestion
- record update
- tombstone handling
- upload retry
- >500 batching
- checkpoint safety
- queue recovery
- Health Connect change conversion
- source priority metadata
- malformed record quarantine

Manual physical-device validation must compare AthleteOS against Samsung Health and test offline recovery, reboot recovery, repeated manual sync, and 7-day reconciliation.

## Gate to Phase 2

Do not begin readiness, recovery, training-load or coaching features until this pipeline survives seven consecutive days without unexplained missing data.

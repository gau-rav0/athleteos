# Codex Task: Build AthleteOS Phase 1

Implement `docs/PHASE1_PRD.md` end to end.

Before coding, read these files completely:

- `docs/PHASE1_PRD.md`
- `docs/HISTORICAL_EXPORT_AUDIT.md`
- `docs/PRODUCT_PRD_PHASES_2_6.md`
- `CODEX_ROADMAP_AFTER_PHASE1.md`

Treat `docs/HISTORICAL_EXPORT_AUDIT.md` as a real audit of the Samsung export already supplied. Its row counts, coverage ranges, parser quirks, source-overlap findings and missing-exercise-file note are requirements for the historical importer. Do not replace them with generic assumptions.

## Repository

Use the existing repository only:

```text
https://github.com/gau-rav0/athleteos
```

Do not create another repository.

## Hard constraints

- Do not commit personal Samsung Health exports.
- Do not commit `android/app/libs/samsung-health-data-api.aar`.
- Do not commit credentials, `.env`, keystores, or Supabase service-role keys.
- Do not build Phase 2 analytics.
- Missing health data must remain missing. Never fabricate values.
- Use Samsung Health Data SDK, not the deprecated Samsung Health SDK for Android.
- Historical Samsung data and future live sync must land in one canonical timeline.

## Required milestones

1. Android scaffold + docs
2. Health Connect adapter
3. Room raw health store and durable upload queue
4. Samsung Health Data SDK adapter
5. Incremental sync + 72-hour reconciliation
6. Supabase auth/schema/Edge Function
7. WorkManager + retry/offline handling
8. Home/Data/Diagnostics UI
9. Samsung historical export importer built against `docs/HISTORICAL_EXPORT_AUDIT.md`
10. Unit tests + integration test documentation

## Historical importer is required

Build a local/offline importer that accepts a user-supplied Samsung Health export root directory and imports the actual Samsung export format described in `docs/HISTORICAL_EXPORT_AUDIT.md`.

It must:

- discover export CSV/JSON files recursively,
- parse Samsung CSV line 1 as dataset metadata and line 2 as the header,
- correctly handle the observed single extra trailing empty field without shifting columns,
- resolve `binning_data`, `extra_data`, and other sidecar JSON references relative to the export root,
- preserve provider/source package/source device/timestamps/timezone offsets/source IDs/raw payload provenance,
- normalize historical records into the SAME record model used by live Health Connect/Samsung sync,
- be dry-run capable, restart-safe and idempotent,
- quarantine malformed rows instead of silently mis-parsing them,
- reconcile overlapping historical/live records without double counting,
- report per-dataset rows discovered/accepted/skipped/malformed/duplicate/missing-sidecar plus earliest/latest timestamp,
- never require the personal export to be added to Git.

Important known facts from the audited export:

- 43 Samsung CSV datasets are present in the supplied subset,
- daily activity history begins in December 2023,
- top-level sleep begins in January 2024,
- detailed sleep-stage, heart-rate, HRV-envelope, SpO2, respiratory-rate and skin-temperature coverage begins around August 2025,
- step summaries have overlapping multi-source rows and must not be blindly summed,
- weight contains Samsung Health, Google Fit and Fitbit provenance,
- the HRV CSV contains sidecar references rather than a direct RMSSD scalar,
- Samsung vitality fields such as `shrv_value` are proprietary and must not be relabelled RMSSD,
- the supplied subset does not include a historical exercise-session CSV,
- workout history must never be fabricated from HR spikes.

## Local Samsung SDK dependency

Expected local file:

```text
android/app/libs/samsung-health-data-api.aar
```

If it is absent, implement everything else, create the adapter boundary and documentation, and report the blocker precisely. Do not download a random mirror.

## Validation

Before pushing, run all feasible:

```text
./gradlew test
./gradlew lint
./gradlew assembleDebug
```

Also validate backend code, migrations, historical importer tests, idempotency, malformed-row handling, overlap reconciliation and dry-run output.

At completion report:

1. files created
2. architecture summary
3. successful commands/tests
4. exact failures
5. Samsung SDK status
6. Health Connect status
7. backend status
8. historical importer status
9. commit list
10. remote URL
11. manual actions still required

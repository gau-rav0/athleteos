# Codex Task: Build AthleteOS Phase 1

Implement `docs/PHASE1_PRD.md` end to end.

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

## Required milestones

1. Android scaffold + docs
2. Health Connect adapter
3. Room raw health store and durable upload queue
4. Samsung Health Data SDK adapter
5. Incremental sync + 72-hour reconciliation
6. Supabase auth/schema/Edge Function
7. WorkManager + retry/offline handling
8. Home/Data/Diagnostics UI
9. Unit tests + integration test documentation

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

Also validate backend code and migrations.

At completion report:

1. files created
2. architecture summary
3. successful commands/tests
4. exact failures
5. Samsung SDK status
6. Health Connect status
7. backend status
8. commit list
9. remote URL
10. manual actions still required

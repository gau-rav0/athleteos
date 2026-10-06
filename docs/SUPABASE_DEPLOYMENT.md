# Phase 1 Supabase deployment

Validated on 6 October 2026 against the existing AthleteOS project. No new project was created. The dashboard reported Healthy, and its GitHub integration points to gau-rav0/athleteos.

## Deployment

The official Supabase CLI 2.119.0 was installed in external local tooling, authenticated through the browser and linked successfully. The repository was clean and already at Samsung bridge commit ea1fca207bef92f4db8b320d8d22120f67640312 before deployment.

The remote migration history was initially empty. CLI dry-run identified exactly these pending migrations, then `supabase db push` applied them in order:

- 0001_phase1.sql
- 0002_phase1_ingestion.sql

A subsequent migration listing confirmed both local and remote versions match. No migration source changes or out-of-band schema patches were required.

`supabase functions deploy sync-batch` succeeded. The function is ACTIVE. `verify_jwt = true` remains configured; deployment did not use `--no-verify-jwt`. Real ES256 Supabase Auth access tokens successfully reached the function. Standard SUPABASE_URL and SUPABASE_ANON_KEY worked without adding custom credentials or a service-role dependency.

The CLI reported Docker was not running, but remote function bundling/upload/deployment completed successfully. Docker was not required for this remote deployment.

## Database verification

Live database catalog queries confirmed:

- devices, raw_health_records and sync_runs exist with RLS enabled.
- Each table has three ownership policies; SELECT/INSERT/UPDATE use auth.uid() = user_id as applicable. No unrestricted anonymous writes were introduced.
- Nine indexes exist, including the raw identity uniqueness constraint and sync-run client identity index.
- ingest_health_batch(jsonb, jsonb, jsonb) exists, uses SECURITY INVOKER and has search_path set to public, pg_temp.
- The anon role cannot execute the ingestion RPC; authenticated can execute it.
- The real project accepted the pgcrypto migration and synthetic password hashing during validation.

Ownership is derived from the authenticated session, never from a client-supplied user_id. Neither migrations nor RLS were weakened.

## Authentication

Browser inspection confirmed Email Auth is enabled, anonymous sign-in is disabled and email confirmation is enabled. Existing settings were preserved. Two disposable synthetic email/password accounts were provisioned through authenticated CLI database access solely for deployment tests, with matching email identities. This confirmed their synthetic addresses without changing global email-confirmation settings. Their generated credentials and Auth session tokens were not committed or printed. Both accounts signed in through the real Auth password endpoint.

These temporary accounts are not usable phone accounts; create/confirm your own account before Android sign-in if you have not already done so.

## Real deployment test results

All calls used generated synthetic records, never the historical export or personal health data.

| Check | Result |
| --- | --- |
| No Authorization header | Rejected, HTTP 401 |
| Malformed JWT | Rejected, HTTP 401 |
| Authenticated synthetic batch | HTTP 200; expected acknowledgement |
| Raw row persisted | Correct Auth user owns the row |
| Duplicate upload | Same logical row; no duplicate |
| Newer source revision | Same row updated |
| Second user reads first user's row | Empty result |
| Second user updates first user's row | No change to owner row |
| Second user inserts under first user's identity | Rejected |
| 501-record batch | Rejected, HTTP 400 |
| Batch with malformed record | Rejected, HTTP 400 |
| Valid sibling of malformed record | No partial write |
| Arbitrary client user_id | Rejected, HTTP 400 |
| Deletion/tombstone | Same row marked deleted |
| Older replay after deletion | Did not resurrect row |
| Newer update after deletion | Same row restored as designed |
| Synthetic cleanup | Accounts, raw rows, devices and sync runs removed |

Cleanup queries confirmed zero remaining rows associated with the disposable account IDs. Initial local harness attempts encountered CLI text/encoding parsing issues; those were corrected and their temporary accounts also removed. The final live validation completed with no failures. Nine existing local Edge Function unit tests and TypeScript checking also passed.

## Android connection and remaining acceptance

The backend is READY FOR PHONE TESTING. The project URL and publishable key were saved only in an external local client-configuration note, not this repository. In AthleteOS Home, enter the server project HTTPS URL and public publishable/anon key, then sign in with your confirmed Email/Password Auth account. Never use a secret/service-role key.

Install the SDK-enabled APK and follow SETUP_PHASE1.md, SAMSUNG_SETUP.md and DEVICE_VALIDATION.md. Phone/watch reads, real permission flows, offline/reboot recovery and the seven-day reliability gate remain untested on physical hardware. No historical data was uploaded, and no Phase 2 functionality was added.

Supabase CLI linkage metadata under supabase/.temp/ is ignored. Access credentials remain in the CLI's local credential storage; no repository credential files were introduced. Public project configuration stays local.

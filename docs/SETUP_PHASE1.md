# Build and deploy Phase 1

## Android

Install JDK 17 and the official Android SDK (platform 36, build tools 35.0.0). Stable Health Connect 1.1.0 requires compile SDK 36. The app targets SDK 35 and has min SDK 29. Configure `JAVA_HOME` and `ANDROID_HOME`, or use ignored `android/local.properties` containing your SDK path. No secrets are compiled into the APK.

```powershell
cd android
.\gradlew.bat test
.\gradlew.bat lint
.\gradlew.bat assembleDebug
```

On Linux/macOS use `./gradlew`. The checked-in Gradle wrapper uses Gradle 8.11.1 with a pinned distribution SHA-256. The wrapper JAR is the only intentional binary tracked in this repository.

Robolectric uses official Maven Central Android runtimes. If Java cannot download them on your network, fetch the following files from `https://repo.maven.apache.org/maven2/org/robolectric/android-all-instrumented/` into an external tooling folder:

- `13-robolectric-9030017-i7/android-all-instrumented-13-robolectric-9030017-i7.jar` (SHA-1 `c2ea93742dee42d01478927baa3ecfd4f84ee6cc`)
- `15-robolectric-12650502-i7/android-all-instrumented-15-robolectric-12650502-i7.jar` (SHA-1 `4a72756411af462a4ca89b355b0834799dc8258e`)

Check each download against Maven's checksum. Then use `gradlew.bat test -ProbolectricDependencyDir=ABSOLUTE_RUNTIME_FOLDER` to run without test-time downloads. Both files are required: API 33 executes the tests, and the target API runtime provides compiled resources. Never commit these binaries.

Install `android/app/build/outputs/apk/debug/app-debug.apk` on your phone, for example using `adb install -r`. No device has been accessed during implementation. SDK tools and intermediate build outputs remain ignored or outside the repository.

## Supabase

Create or choose your own Supabase project. No project reference, access token, database password or deployment credentials are present here. Do not paste a service-role key into Android, GitHub, the importer, or this chat.

Use the official Supabase CLI locally:

```text
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy sync-batch
```

Review migration application before using an existing project with real data. `0001_phase1.sql` creates devices/raw records/sync runs and RLS. `0002_phase1_ingestion.sql` is additive: offsets/provenance/import metadata/revisions/run identities and an atomic, security-invoker ingestion RPC. Both must be applied in order. Keep gateway JWT validation enabled as configured. The function also validates every JWT through Auth and the database derives ownership using `auth.uid()`.

The function uses the standard server-side `SUPABASE_URL` and `SUPABASE_ANON_KEY`. It does **not** use a service-role key. If your deployment environment does not automatically provide them, configure them privately with the CLI/dashboard. Function logs must not contain request bodies, Auth tokens or health payloads. Inspect deployment diagnostics without copying secrets into repository files.

Enable email/password Auth and create/confirm an account using the Supabase dashboard. In AthleteOS Home, enter the project HTTPS base URL, its publishable key or legacy **anon** public key, then your account email/password. Android refuses a secret or legacy service-role key. Session/refresh tokens are encrypted with Android Keystore and are never included in diagnostics. Sign-out removes the local session; queued data stays partitioned by its original account.

The app refreshes sessions on demand. An expired/revoked refresh token requires sign-in again; the local health queue remains durable. No automatic account provisioning, password reset UI or web dashboard is included.

## Health Connect

Install/update Health Connect where required (Android 14+ normally uses the system implementation). Enable Samsung Health's sharing to Health Connect. Grant AthleteOS only the requested **read** permissions. History and background requests are shown only when their feature APIs report support. No write permissions are declared.

Without background-read support/permission, use **Sync Now** while the app is foreground. WorkManager still uploads previously queued records when connected. Periodic work targets three hours, survives restart via WorkManager, and may be delayed by Android. Daily reconciliation happens on the next successful per-type sync after 24 hours; it is not an exact midnight alarm.

An expired token requires complete readable reconciliation. If previously known older records cannot be checked without history access, that type reports `HISTORY_REQUIRED_FOR_TOKEN_RESET` and retains its old cursor. Grant history if supported and sync again. Do not discard data or guess deletions to work around an access restriction.

## Samsung / historical export

Follow SAMSUNG_SETUP.md for the missing official AAR and vendor bridge. Follow HISTORICAL_IMPORT.md to point the local importer at your private export. Neither actual Samsung integration nor private export completeness is certified by a synthetic test suite.

## Automated checks

```text
python -m unittest discover -s scripts -p "test_*.py" -v
deno check supabase/functions/sync-batch/index.ts
deno test supabase/functions/sync-batch
deno lint supabase/functions/sync-batch
deno fmt --check supabase/functions
```

For embedded PostgreSQL validation, install `@electric-sql/pglite@0.3.14` in a tooling directory **outside** the repository, set `ATHLETEOS_PGLITE_MODULE` to its `dist/index.js`, then run `node scripts/test_backend.mjs`. That harness executes both migrations with synthetic Auth roles/users and verifies RLS and the RPC. Only `create extension pgcrypto` is skipped because the embedded distribution lacks that optional extension; PostgreSQL's built-in `gen_random_uuid()` is used. This is not a Supabase deployment test. Validate extension installation and gateway/Auth integration in your project as well.

Before staging run `python scripts/check_staged.py --all`. Before every commit run `python scripts/check_staged.py`, `git diff --cached --check`, inspect `git diff --cached` and `git status`. The scanner complements human review; it cannot recognize every possible personal datum.

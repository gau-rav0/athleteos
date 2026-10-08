# Web preview privacy and security

The repository is public; health data remains private. A folder on GitHub does not protect its contents. Never commit real readings, exports, phone identifiers, source UIDs, credentials, environment files, signed binaries, private logs or authenticated screenshots/session state. Only invented test fixtures are permitted.

## Boundaries

* Server pages and `/api/dashboard` validate the session using Supabase Auth `getUser`, not unverified cookie content.
* Supabase SSR cookies are HttpOnly, SameSite Lax, and Secure in production. The proxy refreshes sessions. No tokens are returned in dashboard JSON or stored in browser localStorage by this application.
* Email/password are submitted privately to the same-origin server. Auth mutations require exact Origin matching `APP_ORIGIN`; login input is strict Zod and bounded to 4 KiB, including streamed bodies.
* Only a publishable/anon key is used server-side. The app has no service-role key and no authentication bypass. Browser integration tests start an independent synthetic HTTP provider; application code does not import that provider.
* Personalized pages/API are dynamic and private/no-store with Cookie variation. No shared personalized server cache or static health HTML is generated. Supabase fetches also disable caching. Per-request aggregates return bounded daily points rather than raw payloads.
* The projection cache is inside Supabase and keyed by raw identity plus owner. `SECURITY INVOKER` RPCs validate `auth.uid()`, use explicit ownership filters and existing raw-table RLS. Projection-table RLS covers select/insert/update. Anonymous callers have no RPC execution grants. Raw deletions/stale revisions are excluded immediately on reads.
* User identity comes from Auth; client-supplied user IDs are never accepted. Raw data remains in existing canonical tables; only additive projection schema/indexes are introduced.
* Logout clears the session, clears displayed data and stops polling. Subsequent server/API requests are revalidated. Back/forward cache restoration reloads the private page. No offline browser health cache is created.
* Generic errors contain no readings/payloads/identifiers. No tracking libraries, external fonts or health telemetry are used. Framing is denied; referrer leakage and camera/mic/geolocation are disabled. CSP restricts connections to same-origin; inline Next hydration/styles remain permitted, and eval is allowed only in local development. CSP does not replace safe React escaping or Auth/RLS.

## Validation

Synthetic SQL tests apply migrations 0001–0005 to PGlite with an Auth shim, then exercise owner, second-user and anonymous roles, invalid bounds, updates and tombstones. This validates policies/functions without production health fixtures. Browser tests independently verify unauthorized redirect/API rejection, SSR login cookies, logout, two account contexts and demo isolation. A test-only Auth provider validates only runtime-generated synthetic tokens. It is not evidence of a successful real Supabase login; that must be separately verified privately.

Staged files must pass `python scripts/check_staged.py` and human-readable diff review before each commit. Next builds, node_modules, environment files and Playwright outputs are ignored. Disable browser traces/videos/screenshots for authenticated tests. Synthetic demonstration images may be kept outside Git for UI review.

Use HTTPS and the exact production origin. Before public hosting, verify real Auth works, deployed RLS/anonymous rejection, no private static generation and no runtime dependency advisories. Do not publish a weakened anonymous real-data endpoint to bypass missing hosting credentials. Free-tier hosting may require a human account login; paid upgrades are not authorized.

## Remaining considerations

Supabase Auth supplies password-auth abuse protections; hosting-level rate limits and operational monitoring should be configured before broader release. This single-user experimental preview has no admin API, reset-password UI, account signup UI or clinical claims. Its private cache is a display projection, not an immutable scientific dataset. A user permitted to edit their own raw/cache data can change their own analytics; RLS prevents cross-user access. Any future sharing/export feature needs explicit separate consent and tests.

## Coverage metadata freshness

Migration 0009 stores exact raw-record coverage snapshots keyed by owner and display timezone under RLS. Normal GET reads only the last snapshot, indexed receipt watermark and latest sync run; it never recomputes the broad raw inventory. The authenticated same-origin inventory POST refreshes eligible snapshots after five minutes and retains the last validated snapshot on failure. Sources reports capture time and stale/unavailable status independently from physiological projection completeness. Inventory and projection workers share client single-flight maintenance scheduling with separate retry backoff, hidden-tab pause and request cancellation. These snapshots contain only existing coverage metadata, not raw payload copies, and do not change canonical ingestion or phone queues.

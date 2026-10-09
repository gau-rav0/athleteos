# AthleteOS web dashboard V1

This is an explicitly authorized experimental preview ahead of the Phase 1 seven-day acceptance gate. It does not certify ingestion completeness or alter that gate. Android, the upload queue and the historical importer are unchanged.

## Application

`web/` is a strict TypeScript Next.js App Router application with React, Tailwind, accessible native dialogs, Recharts, Supabase SSR, Zod, Vitest and Playwright. The five primary screens are Today, Train, Recover, Progress and Insights. Sources/data quality is a drawer. The public `/demo/*` routes contain only invented fixtures, visibly marked DEMO. An authenticated visitor to a demo route is redirected to their private dashboard so live data and demonstration data cannot mix.

Private pages validate the Supabase user on the server. `GET /api/dashboard` independently validates authentication and a bounded range/timezone, reads compact projections and returns source-selected daily aggregates. Projection extraction runs separately through authenticated, same-origin `POST /api/dashboard/projection`; coverage snapshots refresh through `POST /api/dashboard/inventory`. Raw payloads, source UIDs, phone identifiers and user IDs are not returned. A 20-second browser timer refreshes visible partial data or complete data at least 60 seconds old; manual refresh is also available. Range changes clear the displayed snapshot until matching data arrives. All personalized routes are dynamic and use private/no-store responses.

Each authenticated page renders its dashboard with an opaque account discriminator. A private-layout store retains range, timezone and matching snapshots only for the active account within the tab. Same-account navigation reuses fresh snapshots; changing accounts clears retained state and aborts obsolete reads/workers. Logout and invalid-session responses clear private state before document navigation. Temporary refresh failures preserve a matching snapshot without replacing missing values.

## Local setup

Use Node.js 22 or newer supported by Next.js. From `web/`:

```powershell
npm ci
```

Create ignored `web/.env.local` privately:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
APP_ORIGIN=http://127.0.0.1:3100
```

These variables are server-only. No service-role key is needed. Do not commit environment files or put passwords into configuration. Sign in using the existing AthleteOS Supabase Email/Password account, not a GitHub or Supabase dashboard account.

The current consumer requires additive dashboard migrations 0005–0015, applied in order after the existing ingestion migrations. They add projections, durable bounded workers, coverage snapshots and compact tuple reads without changing canonical ingestion. Review the SQL and run the database tests before applying missing migrations to the existing project using the Supabase CLI. Never edit applied migrations. See REVIEW_STATUS.md for the existing project's deployment checkpoint. Then run:

```powershell
npm run dev
```

Open `http://127.0.0.1:3100/login`. The synthetic preview is `http://127.0.0.1:3100/demo/today`. Never publish authenticated screenshots or save browser sessions to the repository.

## Data and performance

`web_health_facts` is a disposable, owner-protected projection of existing `raw_health_records`, not a separate legacy health store. It stores compact scalar/session/hourly facts and tracks the raw revision through `received_at`. Normal GET serving never extracts raw payloads. The projection POST calls `advance_web_projection` with at most 50 extractions, a 2,000-candidate scan bound and a four-second processing deadline, committing exact resumable prefixes. The initial query or an individual extraction can exceed that deadline; the HTTP request has a separate 12-second budget. Older/large selected windows may need repeated worker calls. Partial windows visibly withhold readiness and associations. Existing raw tombstones and changed revisions are excluded immediately until the projection catches up.

The server reads sequential tuple pages through `web_tuple_facts_cursor`, each bounded to 8,000 records and 2 MiB, with explicit continuation preserving PostgreSQL microsecond cursor precision. Reads stop at 100,000 records or a 14-second paging budget; each page receives at most eight seconds and only the remaining budget. Short ranges acquire 61 calendar days of calculation context plus boundary padding; longer selected ranges retain their requested history. Projection status and the latest coverage snapshot are read concurrently with paging. A failed first page is unavailable; a later failure retains a qualified partial snapshot. Incomplete reads, unknown projection status, pending projections and invalid summaries remain explicit. Dense HC heart-rate arrays are compressed during projection extraction. Query counts and qualified server/SQL/decode timings are visible in the data quality drawer; missing SQL timing remains unknown. The SQL tests use 200,000 invented raw records and a 15,000-sample invented HR record.

The database inventory describes uploaded raw-record dates and counts as of the coverage snapshot's capture time; it is not proof of valid physiological observations or complete phone capture. Normal GET reads avoid broad raw inventory aggregation. The inventory POST refreshes eligible owner/timezone snapshots after five minutes, retaining the last validated snapshot on failure. Stale/unavailable inventory is separate from physiological projection completeness. Derived coverage separately counts valid daily points. The latest uploaded sync run is context, not seven-day certification. Historical record counts come from actual server provenance.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm audit --omit=dev
```

Browser tests use an isolated test-only HTTP Auth/RPC provider on ports 3200/3201 with invented accounts. This tests SSR login/logout, cookies, account switching and UI behavior. Real PostgreSQL RLS behavior is separately exercised by PGlite tests running the repository migrations with an Auth shim and two synthetic principals. Browser traces, screenshots and videos are disabled. Public demo test states are `?state=empty`, `sparse`, `partial`, or `error`; those parameters never alter private data APIs.

## Hosting

Hosted stability and production chart rendering are still under investigation; see WEB_VALIDATION.md. The experimental preview is deployed at https://athleteos-dashboard.vercel.app on Vercel Hobby. Public visitors see only login or the labeled synthetic demo; all personal screens and APIs require AthleteOS authentication. The project was deployed with the CLI from `web/`; GitHub pushes do not automatically deploy unless Git integration is separately configured. Subsequent source releases use `npx vercel deploy --prod` from that directory after validation. Hosting configuration and environment files remain outside Git.

Use a free/development Vercel project rooted at `web/`. Set the three server variables in the hosting dashboard; production `APP_ORIGIN` must equal the exact HTTPS origin. Build with `npm run build`, start with `npm run start` on a suitable Node host, and configure the Supabase site/redirect URLs if future recovery links are added. No paid upgrade is authorized. Existing password sign-in does not require a browser OAuth callback.

Before exposing real dashboards, verify anonymous API rejection, private-page redirects, two-user isolation, logout, no-store headers and HTTPS. Do not weaken auth to get a deployment working. Hosting account login/authorization may require the user privately. Deployment status and real-session verification must be reported explicitly; a successful build is not a deployed website.

## Historical integration

No historical export has been imported at this checkpoint. The resumed task authorizes private archive audit, dry-run and overlap preparation after reliability and product acceptance, outside every Git/worktree/build directory. The first historical production upload requires explicit user approval of a concrete, redacted import plan; see [execution gates](PLATFORM_EXECUTION.md). The existing local importer writes the same canonical records with historical provenance. The projection accepts documented historical scalar fields conservatively; unknown formats remain unsupported. Overlap source selection is described in [analytics](WEB_ANALYTICS_V0.md). Validate each additional historical metric with synthetic audited-format fixtures before enabling it. No separate old-data dashboard or database is needed.

See [analytics](WEB_ANALYTICS_V0.md) for exact calculations and [security](WEB_SECURITY.md) for privacy boundaries.

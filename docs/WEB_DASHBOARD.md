# AthleteOS web dashboard V1

This is an explicitly authorized experimental preview ahead of the Phase 1 seven-day acceptance gate. It does not certify ingestion completeness or alter that gate. Android, the upload queue and the historical importer are unchanged.

## Application

`web/` is a strict TypeScript Next.js App Router application with React, Tailwind, accessible native dialogs, Recharts, Supabase SSR, Zod, Vitest and Playwright. The five primary screens are Today, Train, Recover, Progress and Insights. Sources/data quality is a drawer. The public `/demo/*` routes contain only invented fixtures, visibly marked DEMO. An authenticated visitor to a demo route is redirected to their private dashboard so live data and demonstration data cannot mix.

Private pages validate the Supabase user on the server. `/api/dashboard` independently validates authentication, validates a bounded range/timezone, refreshes compact projections and returns source-selected daily aggregates. Raw payloads, source UIDs, phone identifiers and user IDs are not returned. The browser polls only while visible, every 20 seconds, and supports manual refresh. Range changes clear the displayed snapshot until matching data arrives. All personalized routes are dynamic and use private/no-store responses.

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

Apply additive migration `supabase/migrations/0005_web_dashboard_facts.sql` to the existing project using the Supabase CLI after reviewing the SQL and running the database tests. Never edit migrations 0001–0004. Then run:

```powershell
npm run dev
```

Open `http://127.0.0.1:3100/login`. The synthetic preview is `http://127.0.0.1:3100/demo/today`. Never publish authenticated screenshots or save browser sessions to the repository.

## Data and performance

`web_health_facts` is a disposable, owner-protected projection of existing `raw_health_records`, not a separate legacy health store. It stores compact scalar/session/hourly facts and tracks the raw revision through `received_at`. `refresh_web_facts` processes at most 1,000 records per call; a dashboard request processes at most two batches. Older/large selected windows may need several refreshes. Partial windows visibly withhold scores and associations. Existing raw tombstones and changed revisions are excluded immediately until the projection catches up.

Bounded read pages contain at most 1,000 facts. The server fetches five pages concurrently, capped at 100,000 facts in a 734-day window including boundary padding. It returns at most 730 daily points rather than nested raw samples. If the cap or schema validation is reached, the result is partial, never silently complete. Dense HC heart-rate arrays are compressed inside PostgreSQL. Query count and server elapsed time are visible in the data quality drawer. The SQL tests use 200,000 invented raw records and a 15,000-sample invented HR record.

The database inventory describes uploaded raw-record dates and counts; it is not proof of valid physiological observations or complete phone capture. Derived coverage separately counts valid daily points. The latest uploaded sync run is context, not seven-day certification. Historical record counts come from actual server provenance.

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

Use a free/development Vercel project rooted at `web/`. Set the three server variables in the hosting dashboard; production `APP_ORIGIN` must equal the exact HTTPS origin. Build with `npm run build`, start with `npm run start` on a suitable Node host, and configure the Supabase site/redirect URLs if future recovery links are added. No paid upgrade is authorized. Existing password sign-in does not require a browser OAuth callback.

Before exposing real dashboards, verify anonymous API rejection, private-page redirects, two-user isolation, logout, no-store headers and HTTPS. Do not weaken auth to get a deployment working. Hosting account login/authorization may require the user privately. Deployment status and real-session verification must be reported explicitly; a successful build is not a deployed website.

## Historical integration

No export is imported by this task. Later, the existing local importer writes the same canonical records with historical provenance. The projection accepts documented historical scalar fields conservatively; unknown formats remain unsupported. Overlap source selection is described in [analytics](WEB_ANALYTICS_V0.md). Validate each additional historical metric with synthetic audited-format fixtures before enabling it. No separate old-data dashboard or database is needed.

See [analytics](WEB_ANALYTICS_V0.md) for exact calculations and [security](WEB_SECURITY.md) for privacy boundaries.

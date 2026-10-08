# Dashboard preview validation — 2026-10-08

This is an experimental dashboard milestone, not Phase 1 ingestion acceptance.

## Passed

* TypeScript strict checks, ESLint (zero warnings) and Next.js production build. Every private screen and data API is dynamic. Static output consists only of the root redirect and framework not-found page.
* 35 Vitest tests across analytics, authenticated SQL projection and auth request bounds. Synthetic fixtures cover offsets/DST/midnight, overlapping providers and distinct identities, sparse measurements, source changes, baseline withholding, large sample arrays, owner/second-user/anonymous roles, cache revisions and tombstones, and Samsung SDK duration/stage/body-composition mappings.
* 10 Playwright tests across desktop and Pixel 7 viewports: anonymous redirect/API rejection, five screens, ranges, timezones, explanations, charts, no horizontal overflow, empty/sparse/partial/error states, isolated synthetic Auth contexts, visible sign-out, and WCAG A/AA checks. Traces, videos and screenshots are disabled in this suite.
* Local production preview: the user privately signed into the existing Supabase account. Supported live sleep, steps, sleep-window HR, weight, training time, vendor Energy Score, skin-temperature and oxygen charts render. No readings or identity values are recorded here. Missing genuine RMSSD/readiness and respiratory-rate data remain unavailable.
* Migration 0005 applied successfully; migration history confirms 0001–0006 locally/remotely; 0007 was subsequently applied successfully. Read-only deployed checks confirm projection RLS, three ownership policies, invoker-only dashboard RPCs, and denied anonymous execution.
* Runtime dependency audit reports zero vulnerabilities. Staged secret/privacy scan and diff review are required for each delivery commit.

## Performance

PGlite with 200,000 invented raw records: refresh of 1,000 facts plus a 1,000-fact page took 123 ms in the measured warm fixture; compact page JSON was 403,001 bytes. Insertion/setup time is excluded. A separate 15,000-sample invented HR record compressed into fewer than seven hourly buckets and less than 3 KiB of compact JSON.

A representative initial live response took 13,411 ms across 18 bounded data queries while projections were still catching up. This is an observed local-server/remote-database timing, not a hosted latency guarantee. Later queries reuse private per-owner projections; polling processes at most 200 additional records per request. Large ranges can remain partial while catch-up continues. Dense raw samples never reach the browser.

## Resolved failures / remaining limitations

The initial desktop accessibility failure (`scrollable-region-focusable`) was fixed with named focusable table regions. A mobile test navigation race after logout was resolved by waiting for the login document to settle; final full browser run passes. An auxiliary benchmark invocation from the repository root failed to find migration paths; rerunning from the documented `web/` directory passed all nine database tests. It did not change production data.

Full npm audit still reports five high development-only findings through Next ESLint / fast-glob / micromatch / braces. The registry's latest braces release has no compatible fix yet. The supported ESLint 10 executable passes lint, although several Next lint plugins still declare older peer ranges. No forced framework downgrade or paid hosting upgrade is performed.

Historical import is not run. Unknown historical schemas require additional synthetic audited-format tests. Cardio charts show source-labeled logged minutes, not intensity-based load, muscular stress or demonstrated performance improvement. Benchmarks remain an explicit future-input empty state. Associations/readiness remain experimental and are withheld on insufficient or partial evidence. Capture completeness and seven-day reliability are unverified.

## Hosting status

Local URL: `http://127.0.0.1:3100/login`. Vercel Hobby production deployment is READY at https://athleteos-dashboard.vercel.app. Remote production build and TypeScript compilation passed. No paid upgrade was used.

Hosted checks passed: HTTPS/HSTS; public login 200; all five private screens redirect anonymous requests to login; dashboard API returns 401 with private/no-store and Cookie variation; hostile-origin login returns 403. Eight publicly served JavaScript assets were inspected and contain neither server Supabase configuration value. Deployment dry-run verified environment files, local Vercel metadata, build output, tests and browser artifacts are excluded. User-assisted hosted sign-in succeeded. Hosted live refresh remains intermittent: 503/SQLSTATE 57014 occurred in refresh/read RPCs; later requests returned 200 with partial facts. Migrations 0006–0007 are deployed, but stable hosted acceptance is unverified. A production synthetic chart-path check timed out, despite passing plotted-mark tests on the development server. Development stopped at the user’s request.

Synthetic preview images are saved outside the repository. No real-data screenshots, tokens, phone identifiers, exports or environment files are committed or included in deployment uploads.

## Resumed production chart investigation

Anonymous hosted synthetic checks now pass 40 combinations: all five screens, 7/28/90/365-day ranges, desktop/mobile and reduced motion. Each populated chart is checked for finite, nonempty SVG geometry rather than axes or pre-hydration wrappers. The earlier hosted timeout was not reproduced with this readiness check; it does not establish authenticated backend stability.

A separate sparse-data defect was fixed: hiding dots for longer series could make isolated observations invisible because missing dates correctly prevent connecting lines. Observed line/area dots now remain visible, nonfinite values are excluded, and tooltip dates retain their year. Focused desktop/mobile browser regression passes 2/2. The new production runner uses anonymous synthetic data and saves no sessions, screenshots or recordings.

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

## Responsive design review

The obsidian/cyan design adds a stronger hero, refined card depth, readable labels, sticky ranges, 44-pixel controls and mobile safe-area navigation. Missing readiness shows “Building your recovery baseline” without a decorative score placeholder. Five screens passed geometry checks at 1440/1024/768/390/360 pixels, plus every screen in empty/partial states at 360 pixels (35 layouts). Actual synthetic screenshots were inspected outside Git. WCAG A/AA automated checks pass on login and all five screens on desktop and mobile.

The functional browser run initially passed 11/12: one mobile error-state test ambiguously selected both the application error and Next's route announcer. Scoping the assertion to main content fixes the test; both viewport regressions pass. Eight additional projection auth/origin/strict-body/backoff/cancellation/no-overlap tests also pass. Production build and hosted acceptance of these resumed changes are recorded separately below when complete.

## Bounded projection serving

Migration 0008 adds owner-protected per-window checkpoints, indexed watermark status, descending keyset reads and a separate transactional worker. GET performs no extraction; the authenticated same-origin POST processes at most 25 dirty records and 2,000 metadata candidates. Transaction cancellation rolls facts and cursor back together. Revisions/deletions invalidate returned facts immediately, new records trigger reconciliation, and a 15-minute rescan catches late commits behind the watermark. Phone ingestion remains untouched.

The client preserves cached charts during worker failure, backs off from 2 to 60 seconds, pauses work while hidden, cancels requests on range changes/logout, and prevents overlapping reads/workers within the mounted screen. Completed-window reads poll at most once per minute. Failed inventory is explicitly unavailable instead of reported as zero uploads.

All 51 unit/database tests pass, strict TypeScript and lint pass, and the production build passes. Twenty functional desktop/mobile browser tests pass across the full run and focused regression rerun; the separate responsive matrix passes 35 layouts. With 200,000 invented raw rows, measured warm bounded worker latency was 21 ms and status plus keyset page 32 ms in PGlite. These are local fixtures, not hosted guarantees. Before deployment, the existing hosted session reported 37 queries / 35,724 ms; redacted recent production logs still showed 503 failures. Live after-change verification is pending.

The resumed local production build also passes all 40 synthetic chart geometry combinations (desktop/mobile, all five screens and four ranges). Migration 0008 was applied successfully to the existing Supabase project after SQL/RLS tests and review. Deployment dry-run contains 40 source/configuration entries and excludes environment files, private/generated artifacts, tests and the chart runner. Live acceptance remains pending deployment.

## Performance follow-up

The first resumed deployment served finite live chart marks (8/8 on the checked Recover screen), but a 28-day response still took 24,939 ms across 12 queries and remained partial; this is not accepted as stable production. The earlier baseline was 35,724 ms across 37 queries. Read-only authenticated SQL profiling measured inventory at 4,533 ms, checkpoint status at 68 ms and the first compact keyset page at 135 ms. The checked 90-day projection checkpoint is complete; partial serving can also result from the read deadline.

The next source patch overlaps metadata with chart pages, propagates request cancellation, reports performance-only timing counters and caches bounded timezone/calendar formatters without account data. A synthetic 20,000-interval conversion measured 2,315 ms before versus 226 ms after caching. Tests cover DST, fractional offsets, cache eviction and aborted pagination. All 54 unit/database tests and the production build pass; the build includes strict TypeScript. Lint passed. A build type error from using finally on the Supabase PromiseLike was corrected with Promise.resolve before the successful build.

Vercel functions are configured for the single Tokyo region hnd1, colocating with the existing Tokyo Supabase project. This source configuration is pending deployment/live verification. The unproven covering index remains an annotated candidate under docs/performance and is never automatically migrated; warmed synthetic measurements showed no benefit. The hosted synthetic chart runner now waits for client chart geometry before its first range click; 40/40 hosted synthetic combinations pass. None of these synthetic checks substitutes for repeated authenticated acceptance.

## Auth transport checkpoint

Auth HTTP attempts now have a default 10-second no-store deadline while explicit 8/12-second RPC deadlines remain intact. Request-object cancellation is composed with the default budget. Proxy transport failures return generic private 503 responses and preserve all cookie refresh batches. Dashboard GET and projection POST distinguish retryable Auth outages from invalid sessions, avoiding a false 401/sign-out. Eight focused Auth transport tests and six projection-route tests pass; strict TypeScript and targeted lint pass. The timeout is per HTTP attempt, not a guarantee that SDK session-refresh retries finish within ten seconds total. Coverage-snapshot work is a separate in-progress milestone and is not included in this Auth checkpoint.

## Coverage snapshot serving

The next reliability patch adds migration 0009: owner/timezone-scoped metadata snapshots, read-only snapshot serving and a serialized refresh RPC. Exact raw counts/date coverage remain the result of the original raw aggregation, captured at a reported time. Indexed source-watermark changes mark the snapshot stale immediately; successful snapshots are reused for five minutes before another refresh is eligible. Failed replacement rolls back and retains the prior snapshot. Chart completeness is evaluated separately, so unavailable coverage metadata does not withhold otherwise complete physiological summaries.

The same-origin authenticated inventory POST accepts only a validated timezone with a 4 KiB body limit and returns redacted progress. The UI serializes inventory/projection maintenance requests, keeps independent retry backoff, preserves chart data on inventory failure and cancels superseded requests. Sources shows snapshot capture time and stale/unavailable qualifications; cached counts are never presented as current uploaded totals. All 74 unit/database tests, strict TypeScript and lint pass before deployment. New owner isolation, forged insert/update rejection, aggregation failure retention, rollback, tombstone and timezone tests apply migrations 0001–0009 using invented fixtures. Browser/build/live acceptance are recorded after they finish.

Coverage-snapshot integration verification: 74/74 full unit/database tests pass, plus a final 6/6 SQL snapshot rerun after serializing refresh locks across the owner's different timezones. TypeScript and lint pass. The full desktop/mobile browser run passed 26/28; two intentional cancellation tests encountered synthetic-fixture teardown races, fixed with route cleanup. All six inventory browser tests then passed on rerun, so all 28 distinct browser cases have passed across those runs. Existing chart/Auth/accessibility/responsive checks remain green. No private sessions, recordings, screenshots or archive files were used by browser fixtures.

The final coverage-snapshot production build passes, including strict TypeScript and the new inventory API route. Migration/deployment and repeated actual authenticated acceptance follow this source checkpoint; launch reliability is not yet claimed.


## Deployed snapshot checks

Migration 0009 and source checkpoint 84b025e are deployed to the existing Supabase/Vercel projects. New snapshot table RLS and security-invoker/anonymous-denied RPC grants were verified. Hosted synthetic rendering passes 40/40 combinations. Initial actual authenticated Today 7/28/90/365-day responses measured 7,238 / 14,074 / 11,415 / 7,302 ms; all two plotted charts rendered with no UI error, and the yearly response remained partial. Recover 7/28/90/365-day responses measured 5,891 / 8,359 / 5,062 / 12,748 ms; all eight plotted charts rendered with no UI error, and the yearly response remained partial. These are individual checks, not repeated full acceptance or a stability guarantee. Normal reads used 18 queries for short ranges and 20 for the checked year.

Read-only row-count profiling supports reducing the short-range history minimum from 90 to 61 calendar days: approximately 36% fewer cached facts. Current calculations need at most 56 days for complete displayed monthly rolling skin context; 61 days retains 60 preceding days plus today. Requested 90/365-day ranges and canonical raw records remain unchanged. This refinement requires tests and deployment before any after-change performance claim.

The 61-day minimum history patch passes 36 focused analytics/read-serving tests, strict TypeScript, targeted ESLint, formatting and the production Next.js build. Tests preserve the earliest displayed monthly skin deviation, requested 90/365-day calendars and matching read/worker UTC bounds across a DST transition. This is an acquisition optimization, not a new baseline formula. Hosted after-change acceptance is pending deployment.


## Navigation and partial-status verification

Persistent authenticated layout state retains range/timezone and loaded summaries across all five screen navigations without another immediate GET. Per-navigation Auth and route checks remain. Desktop/mobile regression verifies logout clears state and a second synthetic account starts with its own fresh range/data. Partial-status flags distinguish projection backlog, unavailable status, read truncation and invalid summaries; incomplete reads alone schedule no projection worker or short polling, preserve plotted charts, and allow explicit successful refresh. Global analytics withholding remains conservative.

Full browser run: 29/32 passed. Two demo notice tests expected obsolete catch-up wording; one mobile navigation click was obstructed by Next's development badge. Updated truthful wording and disabled only the development indicator using the installed Next documentation; compile/runtime errors still surface. Focused desktop/mobile rerun: 6/6 passed. All 32 distinct cases have passed across these runs. Combined strict TypeScript, ESLint, 97/97 unit/database tests and production build pass. No claim of a single clean full browser run or hosted acceptance.

## Standalone compact transport

Migration 0010 and its version-gated decoder pass 12 focused SQL/codec tests, included in the full 97-test run. Tests cover exact byte bounds with UTF8/escapes, explicit short-page continuation, oversized-fact failure without skipping, original malformed-summary quarantine, owner/anonymous isolation and immediate revision/deletion filtering. Only actual null/default-empty fields are omitted; required provenance/timestamps are never repaired. The migration is not deployed and read serving is not wired to it yet.


## User pause checkpoint

The compact consumer and synthetic provider are now integrated. Latest 32 focused tests, TypeScript, scoped lint and provider syntax checks pass. Explicit has_more controls continuation, canonical cursors must descend with PostgreSQL microsecond precision, invalid records count toward the 100k budget, and malformed later envelopes preserve valid partial charts. Full combined build/browser/unit regression after this consumer change is pending. Migration 0010 and later web source remain undeployed. User requested a stop; save/push this source, preserve both worktrees and wait for explicit RESUME. No historical archive or phone operations occurred.


## Resumed compact-serving regression

After explicit RESUME from 2359bbf, strict TypeScript, full ESLint and all 108 unit/database tests passed. The full desktop/mobile browser suite passed 32/32 in one run; its servers were stopped before building. Test fixtures use the new compact RPC and verify Auth isolation, navigation retention/logout, read truncation versus projection work, cancellation/backoff, sparse geometry and accessibility. Supabase dry-run lists only migration 0010 pending. Deployment/live acceptance follows production build and source checkpoint; local fixtures do not certify hosting reliability. A DOM response timestamp supports verifying that actual refresh checks observed a new response rather than retained chart geometry.

The resumed production build passed, including TypeScript and compact-serving source. The final response-timestamp attribute passes scoped lint and formatting; it adds no health readings to the DOM.


## Resumed deployment — 8 October 2026

Committed source `1795dde` deployed READY to the existing Vercel project as `dpl_3pyEFRdrjEqDemExX2M7p8cFi9DT`; functions remain in `hnd1` (Tokyo). Migration 0010 is applied. Both new functions are security invokers and anonymous execution is denied. The feature branch was clean at upload. Supabase canonical raw storage and Android queues were unchanged.

Hosted anonymous dashboard/projection/inventory requests reject access; hostile/missing mutation Origins reject access. Generic errors, no-store and Vary Cookie remain. New deployed synthetic chart/layout matrix passes 40/40 across five screens, four ranges, desktop/mobile and reduced motion. No invalid chart marks, client errors or horizontal overflow. These are rendering/security checks, not actual database-latency acceptance.

Actual authenticated checks are ongoing. Today 7/28/90/365-day checked responses rendered both chart marks without UI errors; measured work was 5,843 / 7,922 / 12,280 / 15,559 ms respectively. Long ranges can still reach the read budget and return explicit partial results. Train 28-day later completed in 4,542 ms. The latest 15-minute static log scan counted five RPC UNAVAILABLE warnings, with no observed DATA_READ_UNAVAILABLE entry in that scan. Milestone A remains open; first-page failure absence in one scan is not a reliability guarantee. No private values or identifiers were recorded.


## Overnight heart-rate CPU refinement

Precompute Health Connect hourly bucket timestamps once, preserving original traversal/channel ranks/source ties and every existing containment/inclusion rule. Five independent prior-algorithm regressions cover ties, duplicates, boundary cases, malformed dates, multiple sleep intervals, missing samples and partial withholding. Full suite passes 113/113; TypeScript, ESLint and production build pass. Invented 90-day/34,290-fact benchmark measured 1,735→659 ms and 1,664→554 ms, with the entire Dataset deep-equal before/after. Production improvement is not yet measured.

The first deployed-source live matrix checked 20 distinct responses (five screens × four ranges): every expected plot had finite visible marks and zero UI alerts. Ten responses were complete; the others showed summary catch-up and/or read truncation. Yearly projection still has a substantial backlog of existing server records; this is not a historical ZIP upload. Gate A remains open.


## Tuple transport integration

Additive migration 0011 and the v2 consumer preserve all 18 fact fields in positional arrays, including nulls/empty arrays. Pages remain capped at 2 MiB, now with at most 8,000 records; continuation uses canonical owner keysets and microsecond timestamps. v1 remains supported. New SQL/decoder tests cover field equality, nested values, owner/anonymous isolation, revisions/deletions, byte-short pages, UTF8/escaping, oversize-first-record safety and malformed-record quarantine. The consumer retains its 100,000-record/read-deadline bounds; the final partial page gets the remaining record allowance.

Full unit/database suite passes 126/126; TypeScript, ESLint and production build pass. The first browser run was interrupted after 17 failures because the synthetic provider advertised v2 but still supplied objects. That fixture was corrected. The corrected full run passed 31/32; the remaining slow-inventory case exposed nondeterministic initial worker deadlines. Both workers now share one initial timestamp, preserving inventory-first priority. The subsequent relevant desktop/mobile suites passed 18/18 (inventory, projection and all-five-demo cases), including the failed case. All 32 distinct browser cases have passing evidence across these last runs, not one clean full run after the final fix. No assertion was weakened.

Demo response timestamp instrumentation is omitted to prevent SSR/client timestamp hydration mismatches; the private API response timestamp remains available for actual refresh verification. Browser regressions assert no demo hydration errors. Build page-worker concurrency is explicitly one to respect the local RAM constraint; the final build confirms one worker. Test servers were stopped before builds. Migration dry-run lists only 0011. This integration is not yet deployed; actual performance improvement remains unverified.


## Projection processing budget integration — 8 October 2026

Migration 0012 commits exact resumable prefixes after a four-second processing deadline. The authenticated server caller requests up to 50 extractions, retaining its 12-second request budget. Initial query and individual extraction may exceed four seconds; no samples are skipped or truncated.

All 137 unit/database tests passed, including 11 budget SQL regressions with invented fixtures. TypeScript, full ESLint and production build passed using one build worker. Dense continuation, atomic rollback, exact 50/1/0 boundaries, cached-only deadline continuation, bounds, RLS, updates, deletions and late commits are covered. Synthetic timings do not guarantee production latency.

Source c917ac1 and migration 0011 are deployed READY in Tokyo. Hosted synthetic matrix passed 40/40 and anonymous security 7/7. Actual yearly data remains partial; reliability acceptance stays open. Earlier browser failure/focused rerun evidence above remains applicable; this entry does not claim a new clean full browser run.

Migration 0012 dry-run listed only the new migration; application succeeded. Production metadata confirms invoker semantics, authenticated execution and denied anonymous execution. Source 163d210 deployed READY as dpl_FLcXGebxU9hSsWbfj7hAk59KGcTW; CLI inspect verifies hnd1 functions. Fresh full browser regression passed 32/32; authenticated acceptance continues. No source ingestion/phone queue or historical import was performed.

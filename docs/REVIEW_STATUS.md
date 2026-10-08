# AthleteOS review handoff — 8 October 2026

The user explicitly resumed from checkpoint `2359bbf` on 8 October 2026. Compact-serving integration checks are continuing. This is a progress checkpoint, not a completion claim. Review the existing implementation on `feat/athleteos-web-dashboard-v1` and [draft PR #2](https://github.com/gau-rav0/athleteos/pull/2). `main` has not been merged with this dashboard work. Latest deployed source checkpoint: `163d210`; subsequent source/documentation checkpoints continue on this feature branch. Use `git rev-parse HEAD` for the checked-out revision.

```sh
git fetch origin
git switch feat/athleteos-web-dashboard-v1
git log --oneline -15
```

The user has authorized continued web-platform work, specialist agents, reviewed milestone pushes and deployment to the existing free-tier Vercel project. Keep five primary screens. Do not rebuild the project, merge main without approval, modify Android/phone queues, expose private data or upload historical records before the explicit approval gate.

## Implemented and verified

- Existing Next.js/TypeScript dashboard: Today, Train, Recover, Progress and Insights; authenticated private APIs, Supabase SSR Auth and owner RLS.
- Responsive obsidian/cyan design, stronger Today hierarchy, accessible controls, reduced-motion behavior, source-quality drawer and explicit empty/partial states.
- Sparse chart observations remain visible; chart checks verify finite SVG marks rather than only axes or page headings.
- Normal GET serves compact validated projections without extracting raw payloads. Separate bounded POST workers advance durable checkpoints; revision/deletion checks, conservative source selection and backoff remain intact.
- Five-minute owner/timezone coverage snapshots retain exact raw counts as of a reported capture time. Normal reads avoid broad raw inventory aggregation; stale/unavailable metadata is separate from physiological projection completeness.
- Auth transport deadlines, request cancellation, preservation of cookie refresh batches, generic private errors and retryable Auth-outage handling.
- Short ranges acquire 61 calendar days instead of 90, retaining the full calculation context; selected 90/365-day ranges are unchanged. The refinement passes 36 focused tests, TypeScript, targeted lint and production build; live after-change acceptance is pending.
- Single Tokyo function region colocated with the existing Tokyo database; no paid upgrade or new hosting project.
- Repository/deployment guards exclude exports, credentials, tokens, device identifiers, SDK binaries, private captures and generated artifacts. Only invented fixtures enter source control.

## Current source checkpoint for external review

The newest source checkpoint adds persistent authenticated layout state across the five screens, retaining range/timezone/loaded charts without shared or persistent health-data caches. Per-navigation authentication remains in the page. Logout and 401 clear state. New navigation/account-switch browser regressions are included.

Partial status now distinguishes projection backlog, unknown projection status, incomplete reads and invalid summaries. Global partial-data withholding remains conservative; read truncation alone no longer schedules futile projection workers. The 14-second read budget also caps a late page's timeout.

Current source passes **137/137 full unit/database tests**, strict TypeScript and ESLint. The earlier compact-serving checkpoint passed a clean 32/32 desktop/mobile browser run; newer tuple integration passed 31/32 full and 18/18 relevant after its scheduling fix. Current source subsequently passed a clean full 32/32 desktop/mobile run. Production build also passes. These fixture checks do not establish hosted acceptance. No historical audit/import has started.

A lossless compact transport is also implemented and tested as additive migration 0010, decoder and wire-format documentation. It preserves per-record identity/provenance, revision/tombstone filtering and malformed-summary quarantine, with explicit continuation under 4,000-record/2 MiB limits. **Read-serving integration, full local regression and deployment are verified; actual hosted acceptance remains pending.** Canonical cursors preserve microsecond precision. Migration 0010 is now applied; tuple consumer source `c917ac1` and budget integration `163d210` are deployed. It changes neither canonical raw storage nor analytics formulas.

Tuple migration 0011 is applied: versioned 18-field lossless transport raises the maximum to 8,000 records within the same 2 MiB response budget, preserving canonical microsecond cursors and quarantine. Migration 0012 is applied: a four-second processing deadline commits exact resumable prefixes; the authenticated server requests up to 50 extractions. The initial query/individual extraction may exceed that budget. Both revisions preserve owner RLS and raw ingestion. Deployment `dpl_FLcXGebxU9hSsWbfj7hAk59KGcTW` is READY, functions hnd1. Actual yearly reads remain partial; no completion-time estimate is established.

## Validation and deployment

- Latest full unit/database suite: **137/137 passed**. Earlier snapshot SQL rerun: **6/6 passed**.
- Strict TypeScript, ESLint and production Next.js build: **passed**.
- Earlier clean desktop/mobile browser run: **32/32 passed**; newer tuple integration passed 31/32 full and 18/18 relevant after its scheduling fix. Current source subsequently passed a clean full 32/32 desktop/mobile run. Earlier fixture wording/teardown and development-indicator failures were corrected; historical runs remain documented in WEB_VALIDATION.md.
- Responsive inspection: **35 layouts**, five screens and empty/partial states, using synthetic screenshots outside Git.
- Current deployed synthetic chart matrix: **40/40 passed** across five screens, four ranges, desktop/mobile and reduced motion. No runtime errors or horizontal overflow. This tests rendering, not authenticated database performance.
- Hosted anonymous dashboard/inventory/projection APIs reject access; hostile/missing inventory mutation Origin is rejected. Responses are generic and private/no-store.
- Migrations **0005–0010 are deployed**. New snapshot table RLS is enabled; new RPCs are security invokers and anonymous execution is denied.
- Current hosted deployment: [AthleteOS](https://athleteos-dashboard.vercel.app). Source checkpoint `1795dde` is deployed.

## Production reliability remains under review

Before the resumed fixes, an authenticated response took **35,724 ms / 37 queries**; hosted refreshes included HTTP 503 / SQLSTATE 57014. Expensive projection extraction was coupled to serving, and repeated inventory aggregation added database load. Rendering also needed production-specific hydration and sparse-observation fixes.

After separating workers, colocating functions and caching calendar calculations, initial complete authenticated checks took **5,120–8,462 ms**. Later coverage-inventory timeouts still produced partial responses; this led to migration 0009's separate snapshot worker. On the newest deployment, initial complete Today checks measured **14,074 ms** and **7,238 ms**, with real chart marks and no UI error. Latency is still variable. **Milestone A is not accepted yet.** Repeated authenticated five-screen × 7/28/90/365-day checks and refresh verification are in progress.

The speculative covering-index trial showed no measurable benefit and is preserved only in `docs/performance/RAW_INVENTORY_INDEX_CANDIDATE.sql`; it is not a migration and was not deployed. Actual PostgreSQL cancellation after a hosted HTTP disconnect is not proven. SDK session-refresh retries can exceed the per-attempt Auth timeout.

## Implemented but experimental

Existing deterministic analytics include source-selected daily trends, sleep timing/stages, qualified sleep-window HR, weight smoothing/change, logged training duration and evidence-gated readiness/associations. These are versioned wellness-context calculations, not validated clinical or injury-prediction models. See [formulas](WEB_ANALYTICS_V0.md).

Missing genuine RMSSD remains unavailable. Samsung proprietary HRV and Energy Score are not relabeled as RMSSD. Partial projections withhold readiness/associations. Logged minutes do not establish muscular load, cardiovascular strain or precise energy balance.

## Remaining work, in order

1. **A — Live reliability:** finish repeated authenticated screen/range acceptance, investigate remaining latency, verify long-range catch-up and refresh behavior, record measurements and failures honestly.
2. **B — Design acceptance:** integrate any fixes revealed by live use; the current visual redesign and synthetic responsive review are complete, but future feature additions need another visual review.
3. **C — Evidence-supported product features:** configurable sleep reference, full recovery contributors, same-source 7/28/60-day baselines, observed energy timeline, cautious deterministic guidance, personal goals, lightweight journal and comparable strength/cardio benchmarks. Interfaces are agreed; these additions are **not implemented yet**. Coach/labs/camera extension contracts must stay clearly unsupported where no validated pipeline exists.
4. **D — Private historical preparation:** inspect archive integrity outside every Git/build directory, use the existing importer for a private dry-run, resolve sidecar/timestamp uncertainty, quarantine malformed records and compare canonical identities with live overlaps.
5. **E — Historical production integration:** obtain explicit user approval after the concrete dry-run/overlap plan, then authenticated bounded import, live precedence/idempotency checks and dashboard projection backfill.
6. **F — Integrated acceptance:** repeat analytics, SQL/RLS, auth isolation, browser/mobile/accessibility, dependency/privacy, performance and production checks; update PR #2 and the final handoff. Merge requires approval.

The supplied historical ZIP remains **unopened and unextracted** at this checkpoint. No historical production upload, private dry-run, overlap result or backfill completion is claimed. Android and existing upload queues are untouched. Physical ingestion acceptance and the seven-day device reliability gate remain separate from dashboard verification.

## Known limitations and reviewer focus

- Runtime dependency audit: zero findings. Five development-only advisories remain through Next's lint dependency chain, with older peer-range warnings; no forced framework downgrade was performed.
- Focus review on projection cursor/revision/deletion safety, snapshot freshness and exact-count semantics, owner isolation, worker scheduling/cancellation, truthful analytics gating and actual plotted marks.
- Do not request private exports, credentials or authenticated screenshots in a public review. Validate using invented fixtures and structural reports.
- Start with [execution gates](PLATFORM_EXECUTION.md), [validation evidence](WEB_VALIDATION.md), [saved checkpoint](WEB_CHECKPOINT.md), [security](WEB_SECURITY.md) and [web setup](WEB_DASHBOARD.md).

```sh
cd web
npm ci
npm run typecheck
npm run lint
npm test -- --maxWorkers=2
npm run test:e2e
npm run build
```

Schedule browser suites, builds and database benchmarks to respect the local 8 GB RAM constraint. Real Supabase login must use private user input; mocked browser tests never establish hosted acceptance.

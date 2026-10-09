# Live reliability verification — 8 October 2026

## Authenticated browser evidence

The user signed into the existing production dashboard privately. The lead inspected Today, Train, Recover, Progress and Insights at 7, 28, 90 and 365 days. These are 20 screen/range UI states, using the persistent shared range snapshot; they are not 20 independent database reads. Every combination ended with the generic data-read error and no newly loaded snapshot. Selected ranges were checked during the monthly, ninety-day and yearly navigation passes. No combination met reliability acceptance.

| Selected range | Screens inspected | New complete snapshots | Outcome |
| --- | ---: | ---: | --- |
| 7 days | 5 | 0 | Read error; unloaded charts remain unavailable |
| 28 days | 5 | 0 | Fresh read error; initial previously loaded monthly snapshot survived failed refresh |
| 90 days | 5 | 0 | Read error after loading; range retained across navigation |
| 365 days | 5 | 0 | Read error after loading; range retained across navigation |

The initial monthly snapshot contained visible finite chart marks, pending projection summaries and a refresh error. Explicit retry retained that snapshot. Moving to an unloaded range did not reuse observations from another range. A subsequent fresh monthly selection failed without substituting data. This establishes observed error/retention behavior, not complete raw/projection reconciliation, throughput, or a successful post-incident recovery.

Direct navigation to the authenticated dashboard API for a timing-only response was blocked by the in-app browser (`ERR_BLOCKED_BY_CLIENT`). No workaround, cookie extraction, credential collection or raw response export was attempted. Consequently this run has no defensible successful API/SQL/decode/render latency measurement. Earlier numbers in WEB_VALIDATION.md remain historical observations.

The independent production agent could not access the lead's browser tabs because its browser inventory was empty. Browser results above come from the lead's authenticated tab, not that agent's session.

## Read-only provider diagnostics

Vercel CLI access to the existing project succeeded. A capped rolling 30-minute sample of 100 log entries contained 24 entries for dashboard GET: three with HTTP 200 and 21 with HTTP 503. Log entries may repeat a request; trace IDs and usable duration fields were absent, so these are neither independent-request counts nor latency measurements. Sanitized warnings identified fact-page RPC failure (`UNAVAILABLE`) and first-page `DATA_READ_UNAVAILABLE`.

No PGRST002, SQLSTATE 57014 or Auth-unavailable marker appeared in that limited sample. Their absence does not prove recovery or establish a different cause. Supabase project metadata reported ACTIVE_HEALTHY, which does not override observed authenticated serving failures. No restart, cache reload, policy change, schema change, raw/source write, phone queue operation or import occurred during these diagnostics.

## Local fixes and gates

Auth classification now distinguishes invalid/missing sessions from throttling, unknown Auth errors, infrastructure failures and thrown transport errors. Unknown failures deny access without redirecting or emitting 401. Transport exception details are normalized before they reach application boundaries; positive invalid-session evidence still requires login. No unverified identity is accepted.

New synthetic browser regressions exposed an immediate maintenance retry loop after 401 while login navigation remained pending. The fix disables maintenance, aborts outstanding requests, clears timers, the snapshot and explanation panel before navigation. Failed read refreshes continue to preserve the matching snapshot, and retry can recover with a fresh validated response.

Reliability Phase A remains open. Product expansion and historical production import are gated. No ZIP archive was found under the authorized local workspace by filename/metadata search; no private archive contents were opened. The separate seven-day physical Android requirement remains unverified. Main is unmerged and PR #2 remains draft.

Fresh test, commit and deployment details are recorded in REVIEW_STATUS.md as each reviewed milestone completes.

## Auth transport refinement

Installed SDK source inspection showed that an expired refresh session can be removed before the application's error classifier runs: throttling, unknown Auth errors and malformed refresh responses are non-retryable to the SDK unless normalized first. The transport now inspects bounded clones only for the configured Auth user-validation and refresh endpoints. Unknown/transient or malformed responses become sanitized retryable transport errors before SDK session teardown; known invalid sessions remain rejected. Successful user validation requires a nonempty user ID. Inspection is bounded to 16 KiB and oversized responses fail closed as unavailable.

An integration regression uses the actual installed Supabase SSR client and cookie adapter. It verifies that expired refresh cookies survive 429, unknown 400, malformed error JSON and malformed successful refresh, with no validated user supplied during failure. Recovery rotates the refresh cookie and calls the Auth user endpoint. A genuinely invalid refresh token still removes the session; malformed successful user JSON yields no validated identity. Password login, logout, RPC errors and foreign-origin responses retain their original handling.

The privacy scanner initially flagged long invented fixture tokens. A shell command sequence failed to halt and the synthetic-only test was committed; no real credential was present. A corrective fixture commit uses short, explicitly invented tokens. The 11 transport tests and full 182-file workspace scan then passed. Subsequent commit commands explicitly stop on any failed check.

## New failure measurements

Page failures now log measured elapsed time and the actual configured budget even when the first page fails. An exact sanitized transport marker can emit SERVER_TRANSPORT_UNAVAILABLE; a successful RPC whose envelope or keyset cannot be validated emits FACT_ENVELOPE_INVALID. No message, hint, detail, payload, URL or owner identifier is logged. Later failed pages still retain only the validated prefix as explicitly incomplete; scores remain withheld.

## Follow-up — 9 October 2026

Source `a8e4163` deployed READY as `dpl_9Ryj8252NpBd17T1jt2vPVjpXkmk`. A capped five-minute sample of 20 entries included eight dashboard GET entries: seven HTTP 503 and one without status. Five sanitized fact-page warnings reported SERVER_TRANSPORT_UNAVAILABLE at 8,001, 8,002, 8,004, 8,009 and 8,007 ms against the 8,000 ms budget. These establish deadline exhaustion, not successful database timing or its underlying cause. No FACT_ENVELOPE_INVALID was observed in this sample.

Production environment metadata labels the Supabase URL and publishable key as Secret. Vercel's Secret values are write-only after saving, and its current CLI guidance says environment pulls do not supply production/preview Secret values. Pulled placeholders cannot establish invalid production configuration; browser authentication had succeeded. No provider probe was sent with those placeholders and no environment value was changed. See [Vercel Secret environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables) and [CLI environment guidance](https://github.com/vercel/vercel-plugin/blob/main/commands/env.md).

Synthetic account-switch checks exposed an additional privacy defect: a persistent dashboard could retain the previous account's snapshot after a new account was validated on navigation. The fix moves the dashboard into each authenticated leaf and keeps retained settings/snapshots in a layout-scoped store bound to an opaque account discriminator. Changing accounts clears retained state and cancels obsolete work; an obsolete response cannot repopulate the active account. Same-account navigation retains settings and a fresh snapshot. These are fixture regressions; no real account was switched during production diagnostics.

Reviewed source `6474f18` is pushed. The full desktop/mobile suite passed 50/50. An additional navigation run passed 6/6 after extending the account-switch regression through browser back/forward. Strict TypeScript, full lint, scoped formatting, production build and the staged privacy scan passed. The preceding complete unit/database suite passed 210/210; the owner-state change is covered by the browser regressions.

Reopening the authenticated production dashboard subsequently produced complete 28-day and seven-day snapshots with plotted marks, without a refresh error or the fixed incomplete/projection-pending notices. The monthly quality panel reported five bounded data queries, 2,869 ms for the latest server response, 2,259 ms fetching, 442 ms analytics, 1,629 ms inside SQL and 167 ms validation. These are displayed server diagnostics, not browser network or rendering latency. Intermittent recovery does not erase the earlier timeout evidence or certify all ranges.

## Deployed account-isolation acceptance pass

Source `6474f18` deployed READY as `dpl_Ft9Jte6wnqxTGaJbLgk8PzAAEJJC`; the production alias and hnd1 functions were verified. An initial CLI deployment authorization failure resolved by explicitly selecting the existing project scope; no account, permission or plan was changed.

All 20 authenticated screen/range states were inspected again after deployment, waiting for the corresponding screen heading and selected range. These share retained per-range snapshots and are not 20 independent reads. Early navigation samples taken before the new heading settled were excluded. Browser locator readiness occasionally timed out even though subsequent DOM-backed inspection showed the correct page; those waits are not used as rendering benchmarks.

| Range | Screens | Complete states in this pass | Outcome |
| --- | ---: | ---: | --- |
| 7 days | 5 | 5 | Snapshot and plotted marks; no read error or partial notice |
| 28 days | 5 | 5 | Snapshot and plotted marks; no read error or partial notice |
| 90 days | 5 | 5 | Initial projection backlog cleared before the screen pass |
| 365 days | 5 | 0 | Charts remain visible; incomplete reads and pending projections reported |

The yearly panel reported 13 bounded queries and 15,167 ms server work: 13,445 ms fetching, 1,165 ms analytics, 553 ms validation. Total SQL timing was correctly unavailable after an untimed failed page. The measured subset was 10,450 ms across ten timed pages, with one unavailable timing; successful-page RPC was 13,157 ms and failed-page RPC 289 ms. The final page's remaining budget can be much shorter than eight seconds. This evidence points to substantial SQL work in successful yearly pages, without identifying a query-plan cause. A later yearly refresh showed the incomplete-read notice clear while projection backlog remained; this is further partial recovery, not completed acceptance.

Hosted private API checks have passing evidence for all seven valid anonymous/origin cases with no-store headers. The first inventory same-origin attempt used an invalid projection-style body and correctly returned 400; the timezone-only body then returned the expected 401. No authenticated raw API body or private screenshot was exported.

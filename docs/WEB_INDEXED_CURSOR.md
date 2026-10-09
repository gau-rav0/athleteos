# Indexed tuple continuation

Migration 0015 preserves the lossless v2 envelope, canonical microsecond/UUID cursor, byte/record bounds, owner RLS, revision checks, deletion filtering and optional SQL timing. Only the candidate query planning changes.

A nullable cursor OR can become a filter under a cached generic plan. An invented 72,000-row owner fixture plus 4,000 rows for another owner demonstrated a deep continuation removing 60,001 earlier rows by filter. The direct continuation predicate remained an index condition and removed zero earlier rows under both generic and custom plans. This establishes a possible planning inefficiency, not that the production server selected that exact plan.

The new function builds SQL only from fixed string literals, adding a direct cursor predicate when a validated cursor exists. Caller/range/cursor/limit values are passed with EXECUTE USING; no client input is interpolated into SQL. Per-call planning avoids reuse of the nullable generic statement. The existing correlated indexed raw-revision probe remains intact. It does not bypass RLS or change ownership policies.

Reproduce the invented experiment from web:

```sh
node scripts/keyset-plan.mjs
npm test -- tests/tuple-keyset.test.ts --maxWorkers=1
```

The script uses only in-memory PGlite, never a configured/live database. It prints sanitized plan counters and invented aggregate counts, with no SQL parameters or record payloads. All four query variants return identical owner-scoped rows. All nine pages of the 72,000-row synthetic RPC envelopes match the frozen 0014 implementation after excluding observational timing. A sample run measured generic nullable 80 ms versus direct 63 ms; local WASM timings are not production estimates or acceptance criteria.

Ten database regression tests force generic planning and compare the old/new envelopes, covering ordinary and byte-limited UTF8 pages, canonical microseconds and timestamp ties, invalid originals, bounds, oversized-first-record rejection, updates, deletions, and owner/anonymous isolation. The first run passed 9/10 because one comparison still included the reference's SQL timing after stripping the current timing; that assertion now strips only diagnostic timing from both, and 10/10 pass. No data assertion was relaxed.

The broader source suite passes 173/173 unit/database tests; TypeScript, full ESLint and targeted formatting pass. Application/Next.js source is unchanged, so the preceding passing build/browser evidence remains applicable; no new build/browser run is claimed. Deployment and repeated authenticated serving measurements follow. Year-read and projection completeness remain separate acceptance requirements. This migration does not increase deadlines, caps, or suppress partial flags.

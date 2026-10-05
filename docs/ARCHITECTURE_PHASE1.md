# Phase 1 architecture

The implementation contract is CODEX_TASK.md and PHASE1_PRD.md. No Phase 2–6 calculations or screens are implemented.

`android/core` is a JVM 17 Kotlin module with no Android or Samsung dependency. It defines the canonical raw envelope, identity, source policy metadata, source/store boundaries and sync engine. `android/app` supplies Health Connect, Room, HTTPS/Supabase Auth, WorkManager and Compose. Raw records from each provider remain independent.

Local identity includes the authenticated account and a length-delimited provider/type/vendor-ID tuple. Room partitions records, queue, cursors, quarantine and runs by account. Records and queue revisions are committed in the same transaction as change tokens. Acknowledgements match the uploaded revision, preserving edits made during upload. Source cursors represent durable local receipt, not network receipt; an outage leaves the upload queue intact.

Bootstrap creates the source change token before reading the initial snapshot. Every type has its own token. Expiry creates a fresh token before a full readable snapshot and checks previously known IDs. Complete snapshot reconciliation can create tombstones only within the actual readable interval, after all pages and a permission recheck succeed. A failed read never implies deletion. Normal sync reconciles 72 hours; once daily or manually it reconciles seven days.

The backend derives ownership from a validated Supabase Auth JWT. An atomic SQL RPC persists devices, up to 500 raw records and redacted run metadata. Historical imports use the same envelope/provider/IDs and endpoint, with an ingestion-origin flag. Source policy is metadata only; steps are never summed between phone and watch.

Samsung's official AAR is not provided. The unavailable adapter and SDK bridge boundary compile without it. Installing the AAR alone does not constitute an implemented or tested vendor bridge. See SAMSUNG_SETUP.md for the remaining integration work. Physical validation and the seven-day acceptance gate remain mandatory.

# Projection processing budget

The authenticated projection worker keeps a four-second processing deadline
measured from function entry with `clock_timestamp()`. Its caller cannot change
that budget. The existing maximums remain 50 extracted records and 2,000 scanned
metadata records per transaction; the function default remains 25.

After consuming at least one candidate, it checks the deadline before the next
candidate. A time exit reports incomplete work and commits only the exact consumed
prefix: derived facts and the canonical cursor advance together. Future calls
resume at the next identity. Cached records also consume scan budget and may cause
a time exit; an unvisited suffix never becomes a completed checkpoint.

The budget preserves owner RLS, advisory-lock serialization, revision/deletion
checks, 15-minute reconciliation, and source ingestion. No raw data is changed.
Cancellation or a database error still rolls back both facts and checkpoint.

This is a processing budget rather than a guaranteed transaction duration. The
first metadata query and an individual extraction cannot be safely preempted
inside a record. Such work may exceed four seconds; existing database/request
timeouts still fail the entire transaction atomically. Oversized individual work
is a remaining operational blocker, not permission to skip or truncate samples.

Synthetic local testing compares realistic dense 15,000-sample records with small
mixed records. It validates dense prefix continuation, rollback, exact 50-record
boundaries, owner isolation and existing reconciliation invariants. These tests
are not production latency guarantees or physical phone validation.

# Read-stage timing

Migration 0014 adds the optional top-level `sql_ms` diagnostic to the unchanged
v2 tuple envelope. The value is a finite, nonnegative rounded millisecond count.
It starts at SQL function entry and ends after constructing the complete original
envelope. It contains no health values, record/device identities or credentials.

Records, all 18 tuple positions, canonical cursors, byte/row bounds, owner RLS,
revision/deletion checks and execution ACL remain unchanged. The existing envelope
overhead reserve also covers this small scalar diagnostic. Older consumers can
ignore the extra field; consumers must continue to accept envelopes without it.

The SQL counter helps distinguish database construction from the outer RPC time.
The difference includes PostgREST processing, subsequent response serialization,
transport and surrounding runtime overhead. It is not a pure network measurement.
Decoder/validation and analytics timing are separate server stages. Failed reads
have no successful SQL timing response and must not be reported as zero-cost SQL.

Timing is observational metadata for authenticated diagnostics. No raw payload or
canonical identity should be logged or returned to the browser for measurement.
Aggregate counters must be marked unavailable when their successful pages do not
all provide valid timing metadata. Timing must not relax completeness, pagination,
quarantine, cancellation or safety limits.

Synthetic regression checks compare the entire original migration-0013 envelope
with the instrumented result after removing `sql_ms`. They cover 8,000-row and
byte-limited pages, UTF8 escaping, exact full-envelope byte bounds, malformed
originals, oversized first facts, microsecond/tie cursors, empty results,
revision/deletion filtering, cross-owner isolation and anonymous/input rejection.


Partial continuation diagnostics preserve measured SQL only for completed, valid timed pages. Total SQL remains unavailable if any page lacks valid timing. `sqlKnownMs`, `timedPages` and `untimedPages` label the measured subset; successful-page and failed-page RPC durations are reported separately. A failed continuation wait must not be attributed to SQL cost or pure network overhead. Missing counters never imply zero SQL work. Pathological nonfinite, negative or greater-than-ten-minute diagnostic values are treated as unknown without rejecting valid health facts; health/request limits are unchanged.

# Streaming tuple pages

Migration 0013 replaces only `web_tuple_facts_cursor`. Its authenticated,
security-invoker v2 contract remains unchanged: 18 fields, at most 8,000 records,
the same UTF8/escaped JSON byte budget and explicit canonical continuation.

The previous query encoded every candidate before applying the byte limit. When
only part of a page fit, it discarded an encoded suffix and encoded that suffix
again on the next request. The replacement visits the same descending keyset,
encodes the accepted prefix plus one lookahead, and stops before the next record
would exceed either bound. PostgreSQL JSONB arrays accumulate through expanded
SQL arrays; the function avoids repeated concatenation of a growing JSONB value.

Revision/deletion checks, malformed-original markers, source values and owner RLS
are unchanged. Oversized first records still fail explicitly without advancing
past the identity. Timestamp ties and PostgreSQL microseconds retain their exact
ordering. The function performs no writes and keeps the existing ACL.

An invented local PGlite comparison used 8,001 candidates per fixture. Entire
old/new envelopes were identical. With 8,000 ordinary accepted records, two runs
changed from 284/246ms to 209/199ms. With UTF8/escaped strings and a byte-limited
1,901-record prefix, two runs changed from 366/360ms to 89/88ms. These synthetic
results establish local equivalence and a CPU benefit; they are not production
latency guarantees, health-data measurements or evidence that a yearly request
will fit its serving deadline. Production acceptance remains separately required.

Regression tests compare the frozen migration-0011 query with the replacement,
including all pages/identities, exact envelope bytes, 8,000-row boundaries,
byte-limited continuation, invalid originals, nested values, timestamp ties,
revision/deletion filtering and anonymous/cross-owner isolation.

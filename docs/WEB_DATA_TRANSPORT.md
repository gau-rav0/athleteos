# Compact display-fact transport

`web_compact_facts_cursor` is authenticated, security invoker, and owner filtered.
It checks raw revision and deletion status before returning each cached fact. The
cursor comes from canonical table identity/time columns. It does not aggregate,
merge identities, change source selection, or modify canonical raw records.

Wire version **1** returns `wire_version`, `records`, `has_more`, `next_start`, and
`next_id`. Pages contain at most 4,000 distinct records and approximately 2 MiB of
JSON including reserved envelope overhead. A byte-limited page can be short and
still have `has_more=true`; clients must use that explicit continuation flag.
The last accepted canonical identity/time defines the next descending keyset.

Only actual null `end`, `value`, `min`, `max`, `bodyFat` fields and actual empty
`sessions`/`hourly` arrays are omitted. The version-gated server decoder restores
these exact defaults and validates the original Fact schema. Identity, source,
provider, origin, channel, timestamps, rank, samples and support metadata have no
defaults. An original fact missing required shape is marked `transport_invalid`
and counted as quarantined; it is not repaired into a valid observation. Invalid
facts must keep the displayed data incomplete and suppress unsupported inference.

An oversized first fact raises `FACT_TRANSPORT_TOO_LARGE`; it is never skipped or
deleted. An oversized later fact stops the page before its identity, with explicit
continuation. Raw records remain intact for diagnosis and later correction.

Transport data remains server-only. Browser responses continue to contain bounded
daily aggregates rather than raw payloads or canonical record/device identifiers.
This format is unrelated to historical ingestion, Android uploads, or a new model.

Wire version **2**, served by the separate `web_tuple_facts_cursor` RPC, allows
up to 8,000 records within the same 2 MiB byte budget. Each valid record is an
array of exactly 18 positions in this order:

`id, kind, provider, origin, source, channel, rank, start, end, received, value,
samples, min, max, sessions, hourly, supported, bodyFat`.

Every value, including nulls, empty arrays, zeros and false, is retained. The
decoder restores field names by position without inventing defaults and applies
the unchanged Fact schema. Wrong-length or malformed tuples are quarantined;
missing original fields produce the same `transport_invalid` marker. Ordinary
objects in v2 records reject the envelope, preventing ambiguous mixed formats.
The decoder continues to accept v1, with its original 4,000-record limit.

Both versions retain exact PostgreSQL microsecond cursor comparisons, canonical
owner keysets, revision/deletion checks and explicit continuation. A short tuple
page does not imply completion. Oversized first records still fail explicitly.
Byte accounting includes PostgreSQL UTF8/escaped JSON and array separators, with
reserved envelope overhead. This removes repeated field names on the wire; it
does not change summaries, provider selection, source coverage or database data.


Migration 0013 streams the same v2 accepted prefix plus lookahead; records and canonical continuation are unchanged. Migration 0014 optionally reports SQL construction milliseconds in `sql_ms`. Consumers accept older envelopes without this diagnostic. Missing or invalid timing is unknown, never evidence of zero SQL cost, and never grounds for dropping valid health facts. Loader diagnostics separate fact-page RPC, response validation and SQL construction. RPC-minus-SQL includes gateway, serialization and transport overhead rather than pure network time.

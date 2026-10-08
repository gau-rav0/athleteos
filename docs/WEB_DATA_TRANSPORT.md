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

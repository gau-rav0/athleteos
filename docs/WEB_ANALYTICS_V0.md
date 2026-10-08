# Experimental analytics v0.1

Version: `athleteos-analytics-v0.1`. Deterministic server TypeScript consumes validated compact database facts. No personal values are hardcoded. Missing values are null, never substituted with zero or demo data. Reported volume is logged time; physiological training load is withheld.

## Extractor and source policy

The SQL extractor version is 1. Health Connect payloads require `metadata` and documented fields: steps `count`, weight `kilograms`, fat `percentage`, distance `metres`, RMSSD `rmssd_milliseconds`, HR `samples[].beats_per_minute` and timestamped sleep stages. Samsung live records require `sdk_version=1.1.0` and `fields`; explicit mappings include body composition `weight` in kg / `body_fat`, energy `total_score`, oxygen `spo2`, skin `temperature`, HR `heart_rate`, and timestamped `sessions`. ISO 8601 session durations are converted to minutes. Samsung binned HR is not treated as individual HC samples. Unknown schemas are unsupported.

Historical records may use the existing importer's `raw` object. Only documented explicit scalar names are considered; arbitrary aliases and proprietary HRV values are not interpreted. Further historical coverage needs fixture validation when import is separately authorized.

Canonical ingestion identity remains `(user, provider, record_type, source_uid)`. A repeated projection identity is ignored. Distinct identities are never merged merely because timestamps match. Steps/distance choose a provider/package/device channel per day: canonical Samsung activity summaries outrank historical daily summaries, then Watch (HC device type 1), phone (type 2), unknown. Within a chosen channel only non-overlapping intervals are summed. Ambiguous overlapping records cause that channel to be withheld, with a warning; another usable channel can be selected. Channels and device IDs are internal, not browser identifiers. Tie-breaking is deterministic.

Sleep and exercise prefer Samsung sessions over HC for each local date, then choose non-overlapping preferred sessions, longest first. Secondary provider representations are not summed. This is conservative and can omit unique secondary-provider sessions; provenance and incompleteness remain visible. HC asleep stages determine sleep duration when available; otherwise the source interval is explicitly qualified as an interval, not proven time asleep. Known Samsung session durations retain vendor semantics. No session is invented from HR spikes.

Source selection is display analytics only. Raw records stay independently preserved in the existing canonical database. Original UTC instants/offsets remain in raw storage. All calendar boundaries use the selected IANA timezone, initially Asia/Kolkata. Sleep belongs to the local wake date; exercise to the local start date. Cross-midnight step/distance intervals are prorated by elapsed time and flagged as estimates. DST day lengths are respected. SQL HR buckets explicitly use UTC; hosting timezone never defines daily boundaries.

## Derived metrics

| Metric | Definition and minimum evidence |
|---|---|
| Daily HR | Selected channel mean, weighted by genuine HC sample count; Samsung vendor summaries retain separate source semantics. Not clinical resting HR. |
| Sleep-window HR | HC hourly buckets wholly inside selected sleep intervals, from one preferred channel, at least 20 samples. Partial edge hours are excluded. Not clinical resting HR. |
| Daily weight/body fat | Latest actual measurement in the selected channel/local date; no interpolation. |
| Smoothed weight | Median of actual daily measurements in trailing 7 days; at least 3 measured days. |
| Weekly weight change | Latest 7-day median minus preceding 7-day median; at least 2 measured days in each week. Percentage = difference / prior median × 100. Show sample count. |
| 30-day weight change | Median of latest 7 days minus median of the earliest 7 days in the trailing 30-day window; at least 2 measured days in each edge week. No interpolation or claim of a precise daily rate. |
| Skin temperature deviation | Current temperature minus preceding 28-day median from the same provider/package/device channel; at least 14 valid measured days. Source changes do not borrow another device baseline. No medical anomaly diagnosis. |
| Logged cardio minutes | Sum of selected sessions explicitly labeled running, walking, cycling or hiking. Unknown categories and HR spikes are excluded; missing dates remain null. Describes logged time, not strain or proven performance improvement. |
| Training volume | Sum of selected logged session minutes. Recent 7-day total versus preceding 28-day total / 4; ratio requires a positive baseline. Unobserved sessions are not proven rest days. |
| Workout frequency | Count of selected, non-overlapping source sessions in the displayed window. |
| Sleep baseline | Median and MAD of observed durations in the previous 28 days; display sample count. Not a measured sleep requirement. |
| Sleep regularity | MAD of local bedtimes across trailing 28 days, evening times unwrapped around midnight; at least 7 observations. |
| Target sleep | Explicit 480-minute chart/model reference. Not a prescribed individual sleep need. |

RMSSD uses genuine Health Connect records only. Samsung `shrv_value`, HRV envelopes and vendor scores never replace it. Samsung Energy Score remains labeled Samsung Energy Score. Missing respiratory, skin, oxygen or body-fat measurements produce visible empty charts. Consumer measurements do not diagnose conditions. Calorie estimates are not exact expenditure or deficits. Cardiovascular strain/TRIMP and strength benchmarks are withheld pending sufficient intensity/HR evidence or future manual inputs.

## Readiness model

`experimental-readiness-v0.1` is an unvalidated wellness-context model. It requires all three current inputs (sleep, genuine RMSSD, sleep-window HR) and at least 28 paired days in the preceding 35 calendar days (80% coverage). Partial projections always withhold it. No missing-weight renormalization. Confidence is capped at MODERATE.

For each baseline signal, robust z = `(current − median) / max(1, 1.4826 × MAD)`. RMSSD is log transformed first (floored at 0.01 for the logarithm). This conservative unit-specific scale floor is a preview convention, not a validated calibration. Clamp each component to 0–100:

* RMSSD: `70 + 15 × z`, weight 45%, higher relative RMSSD increases the component.
* Sleep: `100 × minutes / 480`, weight 35%, longer sleep up to target increases the component.
* Sleep-window HR: `70 − 15 × z`, weight 20%, higher HR decreases the component.

Round the weighted sum. Explanations show version, required signals, baseline, paired samples, weights and directions. Insufficient evidence yields no score or automated training prescription. Real uploaded data may have no genuine RMSSD; a synthetic demo score must never be mistaken for a real score.

## Associations

`association-block-bootstrap-v0.1`: exploratory Spearman correlation with average tied ranks, at least 30 paired observations, at least 60% selected-calendar coverage, and absolute rho at least 0.3. Sleep versus same-day activity additionally needs at least 20 hours of selected step-interval coverage per date. A deterministic seeded moving-block bootstrap resamples seven adjacent observed pairs, 600 times; report 2.5/97.5 percentile bounds only with at least 500 valid draws. Suppress intervals spanning zero. Partial projections suppress all associations.

Show sample count, coverage, effect size, interval and comparison window. Missing dates mean adjacent observed pairs need not be adjacent calendar days; the bootstrap is approximate. Serial dependence, repeated exploration, confounding, measurement errors and source selection can affect results. Associations are exploratory, not causation or clinical evidence. No claim of significance from a single card.

## Quality limitations

Raw counts, valid sample counts, observed raw dates, source-selected daily points and unique sessions differ. The quality panel distinguishes raw inventory from derived coverage; unknown/malformed facts are counted and mark the window partial. Historical provenance is retained. A server SUCCESS run does not prove a drained phone queue, full source history or seven-day reliability. The dashboard does not fill missing history while synchronization is still underway.

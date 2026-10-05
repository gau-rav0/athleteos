# Historical Samsung Health Export Audit

> Sanitized engineering summary for Codex. This document intentionally contains **no raw health readings, personal profile values, device IDs, Bluetooth addresses, record UUIDs, or authentication material**. The actual export remains private/local and must be imported at runtime.

## Purpose

The Phase 1 importer must be designed against the real Samsung export shape already supplied. The product requirement is:

**historical export + future Samsung/Health Connect sync = one canonical timeline**

No separate legacy database, no historical-only dashboard, and no hardcoded personal readings.

## Supplied export inventory

- **43 Samsung CSV datasets**
- **2 JSON assets**
- The supplied CSV set does **not** contain a `com.samsung.shealth.exercise...csv` / exercise-session CSV.
- Historical workout-session import therefore remains incomplete from the current file subset. Live exercise sync must still be implemented, and the importer must accept an exercise CSV later if present.

## Critical Samsung CSV parser quirk

Every inspected Samsung CSV follows this shape:

1. **Line 1:** Samsung dataset metadata.
2. **Line 2:** actual column names.
3. **Line 3 onward:** records.
4. **Observed records contain one extra trailing empty field** relative to the header.

A naive CSV parser can silently shift columns. The importer must parse the metadata line separately, use line 2 as the header, tolerate only an actually-empty trailing field, and quarantine malformed rows rather than shifting them.

## High-value historical coverage actually present

| Domain | Records | Coverage / shape | Import consequence |
|---|---:|---|---|
| Daily activity summary | 951 rows / 949 unique days | 2023-12-15 → 2026-10-06 | Strong daily backbone. 2 duplicate calendar-day rows exist and must be reconciled. |
| Step daily trend | 2128 rows / 859 unique days | 2024-01-11 → 2026-10-06 | Median 2 source rows/day. Do not sum sources blindly. |
| Pedometer day summary | 2148 rows / 859 unique days | 2024-01-11 → 2026-10-06 | Median 2 rows/day. Preserve source/device and canonicalize later. |
| Fine-grained step count | 7847 rows | 2026-09-01 → 2026-10-05 | Useful recent intraday activity. |
| Sleep sessions | 1009 unique sessions | 2024-01-11 → 2026-10-05 | 569 rows expose sleep score; 644 expose Samsung `sleep_duration`. Coverage richness changes over time. |
| Sleep stages | 31314 stage events / 578 sleep IDs | 2025-08-13 → 2026-10-05 | Detailed stage history starts much later than top-level sleep. Missing stages before this are unknown, not zero. |
| Heart rate | 16962 records / 410 days | 2025-08-13 → 2026-10-05 | Scalar HR on all rows; 3171 rows also reference binned sidecar data. |
| HRV envelope records | 2458 records / 401 days | 2025-08-13 → 2026-10-05 | No direct RMSSD column in CSV. All 2458 rows reference `binning_data`. |
| Samsung vitality score | 351 rows / 350 days | 2025-08-14 → 2026-10-05 | Includes proprietary Samsung HRV/HR balance/value fields and component scores. Preserve vendor semantics. |
| SpO₂ | 510 records / 348 days | 2025-08-13 → 2026-10-05 | Recovery/sleep context. |
| Respiratory rate | 546 records / 364 days | 2025-08-13 → 2026-10-05 | Includes averages/limits/outlier metadata + binned sidecar reference. |
| Skin temperature | 531 records / 351 days | 2025-08-13 → 2026-10-05 | Includes baseline/statistical fields + binned sidecar reference. |
| Movement | 7616 records / 410 days | 2025-08-13 → 2026-10-05 | Mostly binned/sidecar-oriented data. |
| Stress | 1136 records / 98 days | 2025-08-13 → 2026-10-05 | Sparse relative to total calendar range; preserve missingness. |
| Naps | 117 rows | 2025-09-27 → 2026-10-05 | Can later support nap recovery logic. |
| Weight | 71 rows / 63 unique days | 2024-01-10 → 2026-09-29 | Multi-source history; 14 rows also contain body-fat values. |
| Floors climbed raw | 1044 rows | 2025-08-13 → 2026-10-04 | Detailed floor data. |
| Floors daily summary | 315 rows | 2024-10-25 → 2026-10-05 | Separate daily summary source. |
| Food intake | 2189 rows | 2023-12-31 → 2024-08-26 | Historical nutrition context only unless product scope later needs it. |
| Nutrition | 751 rows | 2024-01-11 → 2024-08-26 | Historical nutrient details. |
| Water | 2345 rows | 2024-01-11 → 2025-08-19 | Historical hydration. |
| ECG | 1 record | 2025-08-14 | Preserve raw, no medical interpretation. |
| Mood | 32 rows | 2026-07-10 → 2026-10-01 | Optional low-volume context. |
| Heart health score | 1 row | 2026-08-06 | Preserve Samsung semantics; not a core AthleteOS metric. |
| Training load goal | 2 rows | 2026-08-06 → 2026-09-17 | Configuration/goal only. **Not historical training-load observations.** |

## Source and dedupe findings

### Steps

Multiple daily step/activity representations overlap. `step_daily_trend` and `pedometer_day_summary` each have roughly two source rows per day through much of their coverage.

Rules:
- never add all source rows together,
- retain package/device provenance,
- choose or derive one canonical daily total with explicit source rules,
- use overlapping sources for reconciliation/quality checks.

### Weight

Weight records come from **Samsung Health, Google Fit and Fitbit**. Preserve provenance and dedupe/canonicalize by source identity + timestamp rather than blind overwrite.

### Sleep

Top-level sleep begins in January 2024. Detailed sleep stages begin only in August 2025. Do not manufacture stage values for older nights. Sleep score is also absent on many sessions.

### HRV

The standalone HRV CSV is an envelope/index: timestamps + source/provenance + `binning_data` sidecar reference. It is **not a direct RMSSD table**.

Samsung `vitality_score` separately contains proprietary fields including:
- `shrv_value`
- `prev_shrv_avg`
- `shrv_baseline_min`
- `shrv_baseline_max`
- `shrv_score`

Keep those labels/semantics. Do not rename them to RMSSD unless a supported API/sidecar schema proves the metric.

The user's full export tree includes an HRV JSON directory. The local importer must recursively resolve those sidecars when pointed at the full export folder.

### Workout/exercise gap

No historical exercise-session CSV is present in the supplied chat files. Phase 1 must therefore:
- implement live Health Connect/Samsung exercise reads,
- support a historical exercise CSV if later present,
- mark the current historical exercise source as missing,
- never infer gym sessions from HR spikes.

## Sidecar JSON handling

Several CSVs contain references such as `binning_data` and `extra_data`.

Importer requirements:
1. resolve referenced JSON relative to export root,
2. preserve raw sidecars or raw references,
3. normalize only known schemas,
4. count/report missing sidecars,
5. never fail the entire import due to an optional sidecar,
6. never assign an unlinked JSON blob to a metric by guesswork.

One uploaded `chart_data.json` contains 15,000 floats but is not safely attributable to a metric from its filename/content alone. Keep it unlinked until a parent record references it.

## Historical importer acceptance criteria

The importer must support:
- export-root directory discovery,
- dataset identification from metadata line 1,
- headers from line 2,
- the trailing-empty-field quirk,
- CSV + sidecar resolution,
- dry-run mode,
- idempotent restart,
- row quarantine with reason,
- provenance/timezone preservation,
- raw record preservation,
- normalization into the same schema as live sync,
- overlap reconciliation with live records,
- per-dataset audit report.

Dry-run output must include:
- dataset type + filename
- rows discovered/accepted/skipped/malformed
- duplicates
- missing sidecars
- earliest/latest timestamp
- source package/device counts
- canonical metric(s) produced

## Phase 1 completion rule

The supplied export is the historical seed of AthleteOS, not just documentation.

Phase 1 is not complete until an importer can ingest this export format into the same raw/canonical model as live data and demonstrate one continuous historical + live timeline.

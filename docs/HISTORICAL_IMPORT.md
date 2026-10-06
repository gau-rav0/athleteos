# Private Samsung historical import

The required importer follows `HISTORICAL_EXPORT_AUDIT.md`. It reads a user-provided export directory; no actual export has been accessed, bundled, uploaded or tested during development. All fixtures are synthetic. Python 3.10+ and its standard library are sufficient.

## Point it at your export

Keep the original export and importer state outside the repository. Use a private local folder rather than a cloud-shared folder. The state is a durable upload spool for the same server timeline, not a separate legacy database. It contains private raw records and quarantine. Do not commit it.

First audit without changing the export or queue:

```powershell
python scripts/historical_import.py normalize --dry-run `
  --export-dir 'D:\PrivateHealth\SamsungExport' `
  --state-dir 'D:\PrivateHealth\AthleteOSImport' `
  --report 'D:\PrivateHealth\import-audit.json'
```

Replace both example directory paths with your own. Dataset identifiers come from metadata on line 1, the header from line 2. Exactly one additional empty trailing CSV field is allowed. Nonempty extra fields, extra columns, duplicate/empty headers and malformed records are quarantined with reason codes, never shifted into other columns. Unknown Samsung dataset identifiers are retained as `vendor_raw` with dataset-qualified identities; unrelated CSV files are reported and quarantined.

The report includes each filename/dataset, discovered/accepted/skipped/malformed rows, duplicates, missing sidecars, earliest/latest UTC timestamp, package/device counts, canonical record types, and aggregate totals. It contains coverage timestamps and filenames but no raw readings or source IDs; still keep it private. The historical exercise source reports MISSING unless an exercise CSV is present. No workout is inferred from heart rate.

### Timestamp policy

Explicitly zoned timestamps and Samsung epoch milliseconds convert to UTC; original fields remain unchanged in `payload.raw`. Offsets are preserved independently. Naive datetimes are quarantined by default. Establish their meaning privately before choosing `--naive-time-basis utc` or `--naive-time-basis local`. Local interpretation needs a source offset or an explicit fallback such as `--default-offset=+05:30`. Fallbacks never override source offsets. The audit does not establish the semantics of every timestamp column; do not infer them from your computer timezone.

After reviewing the report, persist the private queue by repeating the command without `--dry-run`:

```powershell
python scripts/historical_import.py normalize `
  --export-dir 'D:\PrivateHealth\SamsungExport' `
  --state-dir 'D:\PrivateHealth\AthleteOSImport' `
  --report 'D:\PrivateHealth\import-audit.json'
```

Add the explicit timestamp policy if required. Every accepted row commits atomically. Rerun after interruption; identical source identities/content are skipped, later vendor updates revise the queue, older updates cannot overwrite newer ones, and ambiguous same-version conflicts are quarantined. Optional sidecars can enrich unchanged parent records on a later run. Exit 2 means quarantine/unsupported CSVs need review, 1 means failure, and 0 means normalization completed; missing optional sidecars are reported separately.

## Coverage and identity

Activity summaries, daily step trends, pedometer summaries and fine step records are separate raw types. No phone/watch sources or daily totals are added together. Distinct IDs on the same date remain distinct. Source package/device provenance is retained, including Samsung/Google Fit/Fitbit weight sources. Sleep stages are separate `sleep_stage` records with their original parent sleep IDs in the raw columns; absent earlier stages stay unknown.

Samsung HRV is `hrv_envelope`, never RMSSD. Referenced bins and proprietary `shrv_*` fields retain vendor labels. Vitality/Energy Score values are preserved vendor data, not new AthleteOS scores. Nutrition, water, ECG, mood, movement, stress, respiratory rate and goal/configuration data remain raw records with no interpretation or Phase 2 analytics. Undated configuration and unknown vendor records remain undated rather than receiving invented timestamps.

Vendor IDs are preserved where supplied. Only documented summary/stage/configuration families without IDs receive a deterministic hash of the entire dataset and complete raw row, labeled `derived_full_row_hash`. This is not a timestamp identity. Changing such a row produces another raw observation because no authoritative update identity exists. Unknown datasets with IDs use a dataset-qualified ID to avoid cross-dataset collisions; the original ID remains in the raw payload.

## JSON assets

The export root is searched recursively. Only explicit parent references are resolved, including `binning_data`, `extra_data`, JSON filename fields and nested references. Relative paths must stay inside the export root. A basename fallback is accepted only if unique. Missing, ambiguous, malformed, unsafe or deeply nested references are reported without discarding the parent. Unlinked JSON (including `chart_data.json`) remains unassigned.

Small JSON sidecars are preserved inside the raw payload; no unknown schema is converted to physiological metrics. Large sidecars are copied privately to `STATE_DIR/sidecars/SHA256.json`; the canonical payload preserves the original reference, content hash and byte count. These assets remain private and are not uploaded separately. Keep the original export and state folder to retain complete raw fidelity. A payload that still exceeds the server limit is quarantined rather than truncated. Dry-run never copies assets or persists state; an explicitly requested report is the only output file it writes.

## Authenticated upload

Deploy the backend and create/confirm your Supabase Auth account first, following `SETUP_PHASE1.md`.

```powershell
$env:ATHLETEOS_PUBLIC_KEY = 'YOUR_PUBLISHABLE_OR_ANON_PUBLIC_KEY'
python scripts/historical_import.py upload `
  --state-dir 'D:\PrivateHealth\AthleteOSImport' `
  --project-url 'https://YOUR_PROJECT.supabase.co'
```

Enter email/password at the prompts; the password is hidden. Never put credentials into command arguments or files. Alternatively supply a short-lived JWT in the local `ATHLETEOS_ACCESS_TOKEN` environment variable. Password sessions refresh in memory; externally provided expired JWTs require a new token. Tokens/passwords are never stored in SQLite or printed. Remove credential environment variables afterward.

The queue binds to the validated Auth user and project, rejects ownership changes and uses the same `sync-batch` endpoint and `raw_health_records` table as live ingestion. Maximum batch size is 500, with a 7 MiB request target. Failed/interrupted uploads remain durable; acknowledgements apply only to the submitted revision. Rerun upload to retry safely.

## Historical/live reconciliation

Server uniqueness is `(user_id, provider, record_type, source_uid)`. Matching Samsung historical/live IDs share one raw row, with live taking precedence. Historical retries cannot overwrite live records. Health Connect remains independently preserved. Different IDs with overlapping timestamps are not silently merged. The Samsung SDK 1.1.0 bridge preserves HealthDataPoint.uid exactly; its correspondence to export datauuid must be verified privately on the phone. Canonical raw types match where supported, but SDK steps/activity are aggregate-only and profile lacks record identity, so those live raw reads remain unsupported. See SAMSUNG_SDK_API.md. Legacy/live ID differences require an evidence-based alias map. Neither a continuous private timeline nor hardware integration is certified by synthetic tests.

After deployment, run the dry-run locally, resolve quarantine/missing references and timestamp semantics, normalize/upload, and compare the private overlapping period with live sync. Confirm stages remain unknown before their coverage and RMSSD remains unavailable without genuine Health Connect records. Keep the audited missing exercise gap explicit. No raw export needs to go to GitHub or this chat.

Historical weight/body-fat observations and live Samsung body-composition envelopes retain their respective canonical raw type names. Nested live sleep stages also remain inside their parent sleep envelope, while audited export stage rows preserve separate stage identities. These representations share the same raw table and timeline; they are not blindly merged. Compare overlapping IDs and representations privately before certifying continuity.

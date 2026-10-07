"""Audited Samsung export reader. Private files remain outside the repository."""

import csv
import hashlib
import json
from pathlib import Path
import re
import sqlite3

# Vendor semantics are retained, without computing scores or interpreting HRV bins.
DATASETS = {
    "activity_day_summary": "activity_summary",
    "activity_summary": "activity_summary",
    "step_daily_trend": "steps_daily",
    "pedometer_day_summary": "pedometer_day_summary",
    "pedometer_step_count": "steps",
    "step_count": "steps",
    "sleep": "sleep",
    "sleep_stage": "sleep_stage",
    "heart_rate": "heart_rate",
    "heart_rate_variability": "hrv_envelope",
    "hrv": "hrv_envelope",
    "vitality_score": "energy_score",
    "energy_score": "energy_score",
    "oxygen_saturation": "blood_oxygen",
    "respiratory_rate": "respiratory_rate",
    "skin_temperature": "skin_temperature",
    "movement": "movement",
    "stress": "stress",
    "nap": "nap",
    "weight": "body_composition",
    "body_composition": "body_composition",
    "floors_climbed": "floors",
    "floors_climbed_day_summary": "floors_daily",
    "floors_climbed_daily_summary": "floors_daily",
    "floor_climbed": "floors",
    "food_intake": "food_intake",
    "nutrition": "nutrition",
    "water_intake": "water",
    "water": "water",
    "ecg": "ecg",
    "electrocardiogram": "ecg",
    "mood": "mood",
    "heart_health_score": "heart_health_score",
    "training_load_goal": "training_load_goal",
    "exercise": "exercise",
    "user_profile": "user_profile",
    "device": "device_metadata",
    "device_profile": "device_metadata",
    "data_origin": "source_metadata",
}
UNDATED = {
    "vendor_raw",
    "training_load_goal",
    "device_metadata",
    "source_metadata",
    "user_profile",
}


def dataset(metadata):
    matches = re.findall(
        r"com\.samsung\.(?:shealth|health)(?:\.[a-zA-Z_][\w]*)+", ",".join(metadata)
    )
    if not matches:
        raise ValueError("DATASET_METADATA_REQUIRED")
    if len(set(matches)) != 1:
        raise ValueError("AMBIGUOUS_DATASET_METADATA")
    return matches[0]


def record_type(table):
    return DATASETS.get(table.rsplit(".", 1)[-1], "vendor_raw")


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.reader(stream, strict=True)
        table = dataset(next(reader, []))
        header = next(reader, [])
        if (
            not header
            or any(not column for column in header)
            or len(set(header)) != len(header)
        ):
            raise ValueError("INVALID_CSV_HEADER")
        yield table, None, None
        for values in reader:
            if not values or not any(values):
                continue
            original = list(values)
            if len(values) == len(header) + 1 and values[-1] == "":
                values = values[:-1]
            yield (
                table,
                dict(zip(header, values)) if len(values) == len(header) else None,
                original,
            )


class Sidecars:
    def __init__(self, root, state, dry_run):
        self.root, self.state, self.dry_run = root, state, dry_run
        self.files = sorted(root.rglob("*.json"))
        self.linked = set()

    def resolve(self, row):
        result, issues, visited = [], [], set()

        def visit(value, parent, depth=0):
            if depth > 16:
                issues.append("SIDECAR_DEPTH_LIMIT")
                return
            if isinstance(value, dict):
                for key, item in value.items():
                    if isinstance(item, (dict, list)):
                        visit(item, parent, depth + 1)
                    elif isinstance(item, str) and (
                        item.lower().endswith(".json")
                        or key.rsplit(".", 1)[-1] in {"binning_data", "extra_data"}
                    ):
                        visit(item, parent, depth + 1)
                return
            if isinstance(value, list):
                for item in value:
                    visit(item, parent, depth + 1)
                return
            if not isinstance(value, str) or not value.strip() or value == "null":
                return
            if value.lstrip().startswith(("{", "[")):
                try:
                    parsed = json.loads(value)
                    result.append({"inline": parsed})
                    visit(parsed, parent, depth + 1)
                except ValueError:
                    issues.append("MALFORMED_INLINE_SIDECAR")
                return
            relative = Path(value.replace("\\", "/"))
            if (
                relative.is_absolute()
                or ".." in relative.parts
                or re.match(r"^[A-Za-z]:", value)
            ):
                issues.append("UNSAFE_SIDECAR_REFERENCE")
                return
            candidates = [(parent / relative), (self.root / relative)]
            if not relative.suffix:
                candidates += [
                    parent / (str(relative) + ".json"),
                    self.root / (str(relative) + ".json"),
                ]
            existing = [path for path in candidates if path.is_file()]
            if not existing:
                names = (
                    {relative.name, relative.name + ".json"}
                    if not relative.suffix
                    else {relative.name}
                )
                existing = [path for path in self.files if path.name in names]
            unique = {path.resolve() for path in existing}
            if len(unique) != 1:
                issues.append("MISSING_SIDECAR" if not unique else "AMBIGUOUS_SIDECAR")
                return
            path = unique.pop()
            if self.root not in path.parents:
                issues.append("UNSAFE_SIDECAR_REFERENCE")
                return
            self.linked.add(path)
            if path in visited:
                return
            visited.add(path)
            try:
                raw = path.read_bytes()
            except OSError:
                issues.append("SIDECAR_READ_FAILED")
                return
            digest = hashlib.sha256(raw).hexdigest()
            reference = {"reference": value, "sha256": digest, "bytes": len(raw)}
            try:
                parsed = json.loads(raw)
                # Keep large payloads private by content hash; no metric inferred from their values.
                if len(raw) <= 32768:
                    reference["raw_json"] = parsed
                else:
                    reference["private_asset"] = "sidecars/" + digest + ".json"
                    if not self.dry_run:
                        directory = self.state / "sidecars"
                        directory.mkdir(exist_ok=True)
                        target = directory / (digest + ".json")
                        if not target.exists():
                            target.write_bytes(raw)
                result.append(reference)
                visit(parsed, path.parent, depth + 1)
            except (ValueError, UnicodeError):
                result.append(reference)
                issues.append("MALFORMED_SIDECAR")

        visit(row, self.root)
        return result, issues


def normalize(
    api, export_dir, state_dir, naive_basis=None, default_offset=None, dry_run=False
):
    export, state = api.private_directory(export_dir), api.private_directory(state_dir)
    if not export.is_dir():
        raise ValueError("EXPORT_DIRECTORY_REQUIRED")
    if state == export or export in state.parents:
        raise ValueError("STATE_MUST_BE_OUTSIDE_EXPORT")
    offset = api.parse_offset(default_offset)
    if dry_run:
        db = sqlite3.connect(":memory:")
        if (state / "import.sqlite3").is_file():
            existing = sqlite3.connect(
                (state / "import.sqlite3").as_uri() + "?mode=ro", uri=True
            )
            existing.backup(db)
            existing.close()
        else:
            db.executescript(
                "create table records(identity text primary key,record_json text,digest text,revision integer,observed_at text,state text); create table quarantine(identity text primary key,raw_json text,reason text);"
            )
    else:
        db = api.open_state(state)
    assets = Sidecars(export, state, dry_run)
    report = {
        "dry_run": dry_run,
        "normalized": 0,
        "unchanged": 0,
        "quarantined": 0,
        "unsupported_files": 0,
        "datasets": [],
        "historical_exercise": "MISSING",
    }
    try:
        for path in sorted(export.rglob("*.csv")):
            if export not in path.resolve().parents:
                raise ValueError("EXPORT_PATH_ESCAPE")
            audit = dict(
                filename=str(path.relative_to(export)),
                dataset_type=None,
                rows_discovered=0,
                accepted=0,
                skipped=0,
                malformed=0,
                duplicates=0,
                missing_sidecars=0,
                earliest_timestamp=None,
                latest_timestamp=None,
                source_package_count=0,
                source_device_count=0,
                canonical_metrics=[],
                reasons={},
            )
            packages, devices = set(), set()
            report["datasets"].append(audit)

            def quarantine(raw, reason):
                encoded = json.dumps(raw, sort_keys=True, ensure_ascii=False)
                db.execute(
                    "insert or replace into quarantine values(?,?,?)",
                    (hashlib.sha256(encoded.encode()).hexdigest(), encoded, reason),
                )
                audit["malformed"] += 1
                audit["reasons"][reason] = audit["reasons"].get(reason, 0) + 1
                report["quarantined"] += 1
                db.commit()

            try:
                for table, row, original in rows(path):
                    audit["dataset_type"] = table
                    kind = record_type(table)
                    audit["canonical_metrics"] = [kind]
                    if kind == "exercise":
                        report["historical_exercise"] = "PRESENT"
                    if original is None:
                        continue
                    audit["rows_discovered"] += 1
                    try:
                        if row is None:
                            raise ValueError("INVALID_CSV_ROW_WIDTH")
                        record = api.normalize_row(table, row, naive_basis, offset)
                        sidecars, issues = assets.resolve(row)
                        if sidecars:
                            record["payload"]["sidecars"] = sidecars
                        if issues:
                            record["payload"]["sidecar_issues"] = issues
                        audit["missing_sidecars"] += sum(
                            issue in {"MISSING_SIDECAR", "AMBIGUOUS_SIDECAR"}
                            for issue in issues
                        )
                        for issue in issues:
                            audit["reasons"][issue] = audit["reasons"].get(issue, 0) + 1
                        for column, target in [
                            ("source_package", packages),
                            ("source_device_id", devices),
                        ]:
                            if record[column]:
                                target.add(record[column])
                        moment = record["start_time"]
                        if moment:
                            audit["earliest_timestamp"] = min(
                                audit["earliest_timestamp"] or moment, moment
                            )
                            audit["latest_timestamp"] = max(
                                audit["latest_timestamp"] or moment, moment
                            )
                        encoded = json.dumps(
                            record,
                            sort_keys=True,
                            ensure_ascii=False,
                            separators=(",", ":"),
                        )
                        if (
                            len(
                                json.dumps(
                                    record["payload"], ensure_ascii=False
                                ).encode()
                            )
                            > 1835008
                        ):
                            raise ValueError("PAYLOAD_TOO_LARGE")
                        identity = hashlib.sha256(
                            json.dumps(
                                [record["provider"], kind, record["source_uid"]]
                            ).encode()
                        ).hexdigest()
                        digest = hashlib.sha256(encoded.encode()).hexdigest()
                        old = db.execute(
                            "select digest,revision,record_json from records where identity=?",
                            (identity,),
                        ).fetchone()
                        if old and old[0] == digest:
                            audit["duplicates"] += 1
                            audit["skipped"] += 1
                            report["unchanged"] += 1
                            continue
                        if old:
                            previous = json.loads(old[2])
                            before, after = (
                                previous.get("source_updated_at"),
                                record.get("source_updated_at"),
                            )
                            if before and after and after < before:
                                audit["skipped"] += 1
                                report["unchanged"] += 1
                                continue
                            # Optional sidecars may appear later without a vendor-record update.
                            before_raw, after_raw = (
                                previous["payload"]["raw"],
                                record["payload"]["raw"],
                            )
                            if before_raw != after_raw and (
                                not before or not after or before == after
                            ):
                                raise ValueError("AMBIGUOUS_SOURCE_UPDATE")
                        now = (
                            api.dt.datetime.now(api.UTC)
                            .isoformat(timespec="microseconds")
                            .replace("+00:00", "Z")
                        )
                        db.execute(
                            "insert into records(identity,record_json,digest,revision,observed_at,state) values(?,?,?,?,?,'PENDING') on conflict(identity) do update set record_json=excluded.record_json,digest=excluded.digest,revision=excluded.revision,observed_at=excluded.observed_at,state='PENDING'",
                            (identity, encoded, digest, old[1] + 1 if old else 1, now),
                        )
                        db.commit()
                        audit["accepted"] += 1
                        report["normalized"] += 1
                    except (
                        ValueError,
                        api.decimal.InvalidOperation,
                        OverflowError,
                    ) as error:
                        reason = str(error)
                        if not re.fullmatch("[A-Z_]+", reason):
                            reason = "INVALID_RECORD"
                        quarantine(
                            {
                                "table": table,
                                "row": row if row is not None else original,
                            },
                            reason,
                        )
            except (csv.Error, UnicodeError, ValueError, OSError) as error:
                reason = (
                    str(error)
                    if re.fullmatch("[A-Z_]+", str(error))
                    else "INVALID_CSV_FILE"
                )
                quarantine({"filename": audit["filename"]}, reason)
                if reason == "DATASET_METADATA_REQUIRED":
                    report["unsupported_files"] += 1
            audit["source_package_count"], audit["source_device_count"] = (
                len(packages),
                len(devices),
            )
        report["unlinked_json_assets"] = sum(
            path.resolve() not in assets.linked for path in assets.files
        )
        report["totals"] = {
            key: sum(audit[key] for audit in report["datasets"])
            for key in [
                "rows_discovered",
                "accepted",
                "skipped",
                "malformed",
                "duplicates",
                "missing_sidecars",
            ]
        }
        return report
    finally:
        db.close()

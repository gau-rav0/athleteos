"""Private, offline-first Samsung CSV importer. No export files or credentials belong in Git.

normalize reads a user-supplied directory into private SQLite. upload is a separate,
explicit action that sends canonical records only to the authenticated sync endpoint.
"""

import argparse
import datetime as dt
import decimal
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import audited_export

REPO = Path(__file__).resolve().parents[1]
UTC = dt.timezone.utc


def private_directory(path):
    resolved = Path(path).expanduser().resolve()
    if resolved == REPO or REPO in resolved.parents:
        raise ValueError("PRIVATE_PATH_MUST_BE_OUTSIDE_REPOSITORY")
    return resolved


def open_state(path):
    folder = private_directory(path)
    folder.mkdir(parents=True, exist_ok=True)
    database_path = private_directory(folder / "import.sqlite3")
    db = sqlite3.connect(database_path)
    db.execute("pragma journal_mode=WAL")
    db.execute("pragma synchronous=FULL")
    db.executescript("""
      create table if not exists metadata(key text primary key, value text not null);
      create table if not exists records(identity text primary key, record_json text not null,
        digest text not null, revision integer not null, observed_at text not null,
        state text not null default 'PENDING', attempts integer not null default 0);
      create table if not exists quarantine(identity text primary key, raw_json text not null, reason text not null);
    """)
    db.execute(
        "insert or ignore into metadata values('device_uid', ?)", (str(uuid.uuid4()),)
    )
    db.commit()
    return db


def field(row, *names):
    for name in names:
        for key, value in row.items():
            if (key == name or key.endswith("." + name)) and value not in (
                None,
                "",
                "null",
            ):
                return value
    return None


def parse_offset(value):
    if value is None:
        return None
    value = str(value).strip()
    if value == "Z":
        return "Z"
    if re.fullmatch(r"[+-]\d{2}:?\d{2}", value):
        sign = -1 if value[0] == "-" else 1
        digits = value[1:].replace(":", "")
        hours, minutes = int(digits[:2]), int(digits[2:])
        if minutes > 59:
            raise ValueError("INVALID_OFFSET")
        seconds = sign * (hours * 3600 + minutes * 60)
    elif re.fullmatch(r"[+-]?\d+", value):
        # Samsung time_offset is milliseconds. This is not a generic seconds field.
        milliseconds = int(value)
        if milliseconds % 1000:
            raise ValueError("INVALID_OFFSET")
        seconds = milliseconds // 1000
    else:
        raise ValueError("INVALID_OFFSET")
    if abs(seconds) > 18 * 3600:
        raise ValueError("INVALID_OFFSET")
    if seconds == 0:
        return "Z"
    return (
        f"{'-' if seconds < 0 else '+'}{abs(seconds) // 3600:02}:{abs(seconds) % 3600 // 60:02}"
        + (f":{abs(seconds) % 60:02}" if seconds % 60 else "")
    )


def offset_zone(offset):
    if offset == "Z":
        return UTC
    parts = [int(value) for value in offset[1:].split(":")]
    seconds = parts[0] * 3600 + parts[1] * 60 + (parts[2] if len(parts) == 3 else 0)
    return dt.timezone(dt.timedelta(seconds=seconds if offset[0] == "+" else -seconds))


def timestamp(value, offset, naive_basis):
    if value is None:
        return None
    value = str(value).strip()
    if re.fullmatch(r"[+-]?\d+(\.\d+)?", value):
        # Export epoch fields are milliseconds. Decimal preserves millisecond precision.
        seconds = decimal.Decimal(value) / 1000
        moment = dt.datetime(1970, 1, 1, tzinfo=UTC) + dt.timedelta(
            microseconds=int(seconds * 1000000)
        )
    else:
        moment = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if moment.tzinfo is None:
            if naive_basis == "utc":
                moment = moment.replace(tzinfo=UTC)
            elif naive_basis == "local" and offset is not None:
                moment = moment.replace(tzinfo=offset_zone(offset))
            else:
                raise ValueError("AMBIGUOUS_NAIVE_TIMESTAMP")
    return (
        moment.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
    )


def normalize_row(table, row, naive_basis=None, default_offset=None):
    record_type = audited_export.record_type(table)
    uid = field(row, "datauuid", "uuid", "source_uid")
    derived = False
    if not uid:
        if (
            record_type
            not in {
                "sleep_stage",
                "steps_daily",
                "pedometer_day_summary",
                "activity_summary",
                "floors_daily",
            }
            | audited_export.UNDATED
        ):
            raise ValueError("SOURCE_ID_REQUIRED")
        uid = (
            "derived:"
            + hashlib.sha256(
                json.dumps([table, row], sort_keys=True, ensure_ascii=False).encode()
            ).hexdigest()
        )
        derived = True
    if not uid.strip() or len(uid) > 512:
        raise ValueError("INVALID_SOURCE_ID")
    if record_type == "vendor_raw" and not derived:
        uid = table + ":" + uid
        if len(uid) > 512:
            raise ValueError("INVALID_SOURCE_ID")
    original_offset = field(row, "time_offset", "zone_offset", "source_zone_offset")
    offset = (
        parse_offset(original_offset) if original_offset is not None else default_offset
    )
    end_offset = parse_offset(field(row, "end_time_offset")) or offset
    start = timestamp(
        field(row, "start_time", "time", "day_time", "date", "create_time"),
        offset,
        naive_basis,
    )
    end = timestamp(field(row, "end_time"), end_offset, naive_basis)
    if start is None and record_type not in audited_export.UNDATED:
        raise ValueError("START_TIME_REQUIRED")
    if start is not None and end is not None and end < start:
        raise ValueError("INVALID_INTERVAL")
    # Keep unmodified vendor columns. The live bridge must map the exact same vendor table/type and datauuid.
    payload = {
        "export_table": table,
        "raw": row,
        "normalization": {
            "identity_scheme": "derived_full_row_hash"
            if derived
            else "dataset_namespaced_source_id"
            if record_type == "vendor_raw"
            else "vendor_id",
            "naive_time_basis": naive_basis,
            "offset_origin": "source"
            if original_offset is not None
            else "user_supplied"
            if default_offset
            else "missing",
        },
    }
    record = {
        "provider": "samsung_health",
        "record_type": record_type,
        "source_uid": uid,
        "source_package": field(row, "pkg_name", "source_package"),
        "source_device_id": field(row, "deviceuuid", "device_uuid", "source_device_id"),
        "device_provenance": {"export_dataset": table},
        "start_time": start,
        "end_time": end,
        "source_zone_offset": offset,
        "end_zone_offset": end_offset,
        "source_created_at": timestamp(field(row, "create_time"), offset, naive_basis),
        "source_updated_at": timestamp(
            field(row, "update_time", "modified_time"), offset, naive_basis
        ),
        "schema_version": 1,
        "payload": payload,
        "deleted": False,
        "ingestion_origin": "historical",
        "source_priority": 0
        if record_type
        in {"steps", "steps_daily", "pedometer_day_summary", "activity_summary"}
        else 200,
    }
    if (
        len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode())
        > 262144
    ):
        raise ValueError("PAYLOAD_TOO_LARGE")
    return record


def normalize(
    export_dir, state_dir, naive_basis=None, default_offset=None, dry_run=False
):
    return audited_export.normalize(
        sys.modules[__name__],
        export_dir,
        state_dir,
        naive_basis,
        default_offset,
        dry_run,
    )


def request_json(url, public_key, body=None, token=None):
    headers = {"apikey": public_key, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers,
    )

    # Reject redirects so credentials cannot be forwarded to another origin.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, hdrs, newurl):
            return None

    with urllib.request.build_opener(NoRedirect()).open(
        request, timeout=60
    ) as response:
        data = response.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024:
            raise ValueError("RESPONSE_TOO_LARGE")
        return json.loads(data)


def upload(state_dir, project_url, public_key, email=None):
    parsed = urllib.parse.urlparse(project_url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise ValueError("HTTPS_PROJECT_URL_REQUIRED")
    if not public_key or public_key.startswith("sb_secret_"):
        raise ValueError("PUBLIC_KEY_REQUIRED")
    if not public_key.startswith("sb_publishable_"):
        import base64

        try:
            claims = json.loads(
                base64.urlsafe_b64decode(public_key.split(".")[1] + "==")
            )
        except Exception:
            raise ValueError("PUBLIC_KEY_REQUIRED") from None
        if claims.get("role") != "anon":
            raise ValueError("PUBLIC_KEY_REQUIRED")
    url = project_url.rstrip("/")
    token = os.environ.get("ATHLETEOS_ACCESS_TOKEN")
    refresh = None
    expires = 0
    if not token:
        email = email or input("Supabase email: ")
        auth = request_json(
            url + "/auth/v1/token?grant_type=password",
            public_key,
            {"email": email, "password": getpass.getpass("Supabase password: ")},
        )
        token, refresh = auth["access_token"], auth["refresh_token"]
        expires = time.time() + auth["expires_in"]
    # Authenticate ownership before accessing the import queue.
    user = request_json(url + "/auth/v1/user", public_key, token=token)["id"]
    db = open_state(state_dir)
    accepted = 0
    try:
        # Serialize first-time ownership binding across concurrent invocations.
        db.execute("begin immediate")
        owner = db.execute("select value from metadata where key='user_id'").fetchone()
        if owner and owner[0] != user:
            raise ValueError("IMPORT_ACCOUNT_MISMATCH")
        project = db.execute(
            "select value from metadata where key='project_url'"
        ).fetchone()
        if project and project[0] != url:
            raise ValueError("IMPORT_PROJECT_MISMATCH")
        db.execute("insert or ignore into metadata values('project_url', ?)", (url,))
        db.execute("insert or ignore into metadata values('user_id', ?)", (user,))
        device_uid = db.execute(
            "select value from metadata where key='device_uid'"
        ).fetchone()[0]
        db.execute(
            "update records set state='PENDING' where state in ('UPLOADING','FAILED')"
        )
        db.commit()
        while True:
            candidates = db.execute(
                "select identity,record_json,revision,observed_at from records where state='PENDING' order by identity limit 500"
            ).fetchall()
            if not candidates:
                break
            records, selected, size = [], [], 0
            for identity, encoded, revision, observed in candidates:
                record = json.loads(encoded)
                record.update(client_revision=revision, observed_at=observed)
                record_size = len(json.dumps(record).encode())
                if records and size + record_size > 7 * 1024 * 1024:
                    break
                records.append(record)
                selected.append((identity, revision))
                size += record_size
            db.executemany(
                "update records set state='UPLOADING',attempts=attempts+1 where identity=? and revision=?",
                selected,
            )
            db.commit()
            try:
                if refresh and time.time() >= expires - 60:
                    auth = request_json(
                        url + "/auth/v1/token?grant_type=refresh_token",
                        public_key,
                        {"refresh_token": refresh},
                    )
                    if auth["user"]["id"] != user:
                        raise ValueError("IMPORT_ACCOUNT_MISMATCH")
                    token, refresh, expires = (
                        auth["access_token"],
                        auth["refresh_token"],
                        time.time() + auth["expires_in"],
                    )
                result = request_json(
                    url + "/functions/v1/sync-batch",
                    public_key,
                    {
                        "device": {
                            "device_uid": device_uid,
                            "platform": "offline_import",
                            "model": None,
                            "app_version": "importer-0.1",
                        },
                        "records": records,
                        "runs": [],
                    },
                    token,
                )
                if (
                    result.get("accepted") != len(records)
                    or result.get("runs_accepted") != 0
                ):
                    raise ValueError("INVALID_ACKNOWLEDGEMENT")
                db.executemany(
                    "update records set state='SYNCED' where identity=? and revision=?",
                    selected,
                )
                db.commit()
                accepted += len(records)
            except Exception:
                db.executemany(
                    "update records set state='FAILED' where identity=? and revision=?",
                    selected,
                )
                db.commit()
                raise ValueError("UPLOAD_FAILED_QUEUE_RETAINED") from None
        return {
            "accepted": accepted,
            "quarantined": db.execute("select count(*) from quarantine").fetchone()[0],
        }
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    local = sub.add_parser(
        "normalize", help="Read export offline into private durable SQLite; no network"
    )
    local.add_argument(
        "--dry-run",
        action="store_true",
        help="Read-only audit; no state or network writes",
    )
    local.add_argument(
        "--report", help="Write detailed audit JSON outside the repository"
    )
    local.add_argument("--export-dir", required=True)
    local.add_argument("--state-dir", required=True)
    local.add_argument("--naive-time-basis", choices=["utc", "local"])
    local.add_argument(
        "--default-offset",
        help="Explicit fallback only, e.g. +05:30; original offset always wins",
    )
    remote = sub.add_parser(
        "upload", help="Upload the private queue to your authenticated Supabase account"
    )
    remote.add_argument("--state-dir", required=True)
    remote.add_argument("--project-url", required=True)
    remote.add_argument("--email")
    args = parser.parse_args()
    try:
        if args.command == "normalize":
            result = normalize(
                args.export_dir,
                args.state_dir,
                args.naive_time_basis,
                args.default_offset,
                args.dry_run,
            )
            if args.report:
                report_path = private_directory(args.report)
                export_path = private_directory(args.export_dir)
                if report_path == export_path or export_path in report_path.parents:
                    raise ValueError("REPORT_MUST_BE_OUTSIDE_EXPORT")
                report_path.parent.mkdir(parents=True, exist_ok=True)
                report_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        else:
            result = upload(
                args.state_dir,
                args.project_url,
                os.environ.get("ATHLETEOS_PUBLIC_KEY"),
                args.email,
            )
        print(
            json.dumps(result)
        )  # Audit counts/coverage only; no readings, IDs or credentials.
        return 2 if result.get("quarantined") or result.get("unsupported_files") else 0
    except (ValueError, OSError, urllib.error.URLError, KeyError):
        print(
            "IMPORT_FAILED: inspect private state and setup; no raw values or credentials were logged",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())

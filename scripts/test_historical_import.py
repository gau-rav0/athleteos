"""Synthetic data only. These tests never read the user's export or make network requests."""

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import historical_import as importer


class ImportTest(unittest.TestCase):
    def test_identity_timestamps_and_offsets(self):
        row = {
            "datauuid": "synthetic-id",
            "start_time": "2025-01-02T00:15:00+05:30",
            "time_offset": "19800000",
            "deviceuuid": "synthetic-device",
        }
        record = importer.normalize_row("com.samsung.health.step_count", row)
        self.assertEqual("2025-01-01T18:45:00.000000Z", record["start_time"])
        self.assertEqual("+05:30", record["source_zone_offset"])
        self.assertEqual(row, record["payload"]["raw"])
        self.assertEqual("synthetic-id", record["source_uid"])

    def test_ambiguous_time_never_guessed(self):
        row = {"datauuid": "synthetic-id", "start_time": "2025-01-02 00:15:00"}
        with self.assertRaises(ValueError):
            importer.normalize_row("com.samsung.health.step_count", row)
        record = importer.normalize_row(
            "com.samsung.health.step_count", row, "local", "+05:30"
        )
        self.assertEqual("2025-01-01T18:45:00.000000Z", record["start_time"])
        self.assertEqual(
            "user_supplied", record["payload"]["normalization"]["offset_origin"]
        )

    def test_numeric_epoch_milliseconds(self):
        self.assertEqual(
            "1970-01-01T00:00:01.500000Z", importer.timestamp("1500", None, None)
        )
        self.assertEqual("-04:00", importer.parse_offset("-14400000"))
        for invalid in ["+18:01", "+05:99", "1234"]:
            with self.assertRaises(ValueError):
                importer.parse_offset(invalid)

    def test_private_paths_reject_repository(self):
        with self.assertRaises(ValueError):
            importer.open_state(importer.REPO / "private")

    def test_duplicate_update_and_quarantine_are_durable(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            export = root / "export"
            export.mkdir()
            state = root / "state"
            file = export / "com.samsung.health.step_count.csv"
            file.write_text(
                "com.samsung.health.step_count,version\ndatauuid,start_time,update_time,count\nsynthetic-id,2025-01-02T00:00:00Z,2025-01-02T00:01:00Z,1\n,not-a-time,not-a-time,invalid\n",
                encoding="utf-8",
            )
            with patch.object(
                importer.urllib.request,
                "build_opener",
                side_effect=AssertionError("normalize must stay offline"),
            ):
                self.assertEqual(1, importer.normalize(export, state)["normalized"])
                self.assertEqual(1, importer.normalize(export, state)["unchanged"])
                file.write_text(
                    "com.samsung.health.step_count,version\ndatauuid,start_time,update_time,count\nsynthetic-id,2025-01-02T00:00:00Z,2025-01-02T00:02:00Z,2\n",
                    encoding="utf-8",
                )
                self.assertEqual(1, importer.normalize(export, state)["normalized"])
            db = importer.open_state(state)
            self.assertEqual(
                (1, 2),
                db.execute("select count(*),max(revision) from records").fetchone(),
            )
            self.assertEqual(
                1, db.execute("select count(*) from quarantine").fetchone()[0]
            )
            db.close()

    def test_older_exports_cannot_replace_newer_records_and_ambiguous_conflicts_quarantine(
        self,
    ):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            export = root / "export"
            export.mkdir()
            state = root / "state"
            file = export / "com.samsung.health.step_count.csv"
            file.write_text(
                "com.samsung.health.step_count,version\ndatauuid,start_time,update_time,count\nsynthetic,2025-01-01T00:00:00Z,2025-01-01T00:02:00Z,2\n"
            )
            importer.normalize(export, state)
            file.write_text(
                "com.samsung.health.step_count,version\ndatauuid,start_time,update_time,count\nsynthetic,2025-01-01T00:00:00Z,2025-01-01T00:01:00Z,1\n"
            )
            self.assertEqual(1, importer.normalize(export, state)["unchanged"])
            file.write_text(
                "com.samsung.health.step_count,version\ndatauuid,start_time,update_time,count\nsynthetic,2025-01-01T00:00:00Z,2025-01-01T00:02:00Z,3\n"
            )
            self.assertEqual(1, importer.normalize(export, state)["quarantined"])

    def test_duplicate_headers_and_unsupported_files_reported(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            export = root / "export"
            export.mkdir()
            (export / "com.samsung.health.step_count.csv").write_text(
                "com.samsung.health.step_count,version\ndatauuid,datauuid\nsynthetic,synthetic\n"
            )
            (export / "unknown.csv").write_text(
                "unknown,version\ndatauuid,start_time\nsynthetic,2025-01-01T00:00:00Z\n"
            )
            result = importer.normalize(export, root / "state")
            self.assertEqual(2, result["quarantined"])
            self.assertEqual(1, result["unsupported_files"])

    def test_failed_upload_retains_queue_without_storing_credentials(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            state = root / "state"
            db = importer.open_state(state)
            record = importer.normalize_row(
                "com.samsung.health.step_count",
                {"datauuid": "synthetic", "start_time": "2025-01-01T00:00:00Z"},
            )
            db.execute(
                "insert into records(identity,record_json,digest,revision,observed_at) values('synthetic',?,'synthetic',1,'2025-01-01T00:00:00Z')",
                (json.dumps(record),),
            )
            db.commit()
            db.close()
            with (
                patch.dict(
                    importer.os.environ, {"ATHLETEOS_ACCESS_TOKEN": "synthetic-token"}
                ),
                patch.object(
                    importer,
                    "request_json",
                    side_effect=[{"id": "synthetic-user"}, OSError("offline")],
                ),
            ):
                with self.assertRaises(ValueError):
                    importer.upload(
                        state,
                        "https://example.supabase.co",
                        "sb_publishable_synthetic-public-key",
                    )
            db = importer.open_state(state)
            self.assertEqual(
                "FAILED", db.execute("select state from records").fetchone()[0]
            )
            self.assertNotIn(
                "synthetic-token", str(db.execute("select * from metadata").fetchall())
            )
            db.close()


if __name__ == "__main__":
    unittest.main()

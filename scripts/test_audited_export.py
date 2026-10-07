"""Audit-format reliability coverage, using invented fixtures only."""

import csv
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import audited_export
import historical_import as importer


class AuditedExportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.export = self.root / "export"
        self.export.mkdir()
        self.state = self.root / "state"

    def write(self, kind, records, header=None, filename=None):
        header = header or ["datauuid", "start_time", "pkg_name", "deviceuuid"]
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer)
        writer.writerow(["com.samsung.health." + kind, "synthetic-version"])
        writer.writerow(header)
        for row in records:
            writer.writerow(row)
        path = self.export / (filename or kind + ".csv")
        path.write_text(buffer.getvalue(), encoding="utf-8", newline="")
        return path

    def read_records(self):
        db = importer.open_state(self.state)
        try:
            return [
                json.loads(row[0])
                for row in db.execute("select record_json from records")
            ]
        finally:
            db.close()

    def test_metadata_not_filename_and_exact_trailing_empty_field(self):
        self.write(
            "step_count",
            [
                ["a", "2025-01-01T00:00:00Z", "synthetic-package", "watch", ""],
                ["b", "2025-01-01T00:00:00Z", "synthetic-package", "phone", "nonempty"],
                ["c", "2025-01-01T00:00:00Z", "synthetic-package", "phone", "", ""],
            ],
            filename="unrelated.csv",
        )
        result = importer.normalize(self.export, self.state)
        self.assertEqual((1, 2), (result["normalized"], result["quarantined"]))
        self.assertEqual("steps", self.read_records()[0]["record_type"])

    def test_dry_run_has_no_state_or_network_writes_and_reports_coverage(self):
        self.write(
            "step_count",
            [["a", "2025-01-01T00:00:00Z", "synthetic-package", "watch", ""]],
        )
        with patch.object(
            importer, "request_json", side_effect=AssertionError("offline")
        ):
            report = importer.normalize(self.export, self.state, dry_run=True)
        self.assertFalse(self.state.exists())
        row = report["datasets"][0]
        self.assertEqual(1, row["source_device_count"])
        self.assertEqual(1, row["source_package_count"])
        self.assertEqual("2025-01-01T00:00:00.000000Z", row["earliest_timestamp"])
        self.assertEqual(
            {
                "rows_discovered": 1,
                "accepted": 1,
                "skipped": 0,
                "malformed": 0,
                "duplicates": 0,
                "missing_sidecars": 0,
            },
            report["totals"],
        )

    def test_payload_limit_measures_compact_utf8_without_removing_string_spaces(self):
        # Invented wide schema: pretty JSON exceeds the limit, wire JSON fits.
        fields = {f"synthetic_{i}": "space preserved é" for i in range(45500)}
        fields.update(datauuid="synthetic-wide", start_time="2025-01-01T00:00:00Z")
        self.write("heart_rate", [list(fields.values()) + [""]], header=list(fields))
        result = importer.normalize(self.export, self.state)
        self.assertEqual(1, result["normalized"])
        payload = self.read_records()[0]["payload"]
        compact = json.dumps(
            payload, ensure_ascii=False, separators=(",", ":")
        ).encode()
        pretty = json.dumps(payload, ensure_ascii=False).encode()
        self.assertLessEqual(len(compact), 1835008)
        self.assertGreater(len(pretty), 1835008)
        self.assertEqual("space preserved é", payload["raw"]["synthetic_0"])

    def test_existing_state_dry_run_does_not_change_revision(self):
        self.write(
            "sleep", [["a", "2025-01-01T00:00:00Z", "synthetic-package", "watch", ""]]
        )
        importer.normalize(self.export, self.state)
        self.assertEqual(
            1, importer.normalize(self.export, self.state, dry_run=True)["unchanged"]
        )
        self.assertEqual(1, importer.normalize(self.export, self.state)["unchanged"])

    def test_separate_stages_preserve_parent_and_unknown_historical_stages(self):
        self.write(
            "sleep",
            [["session", "2025-01-01T00:00:00Z", "synthetic-package", "watch", ""]],
        )
        self.write(
            "sleep_stage",
            [["session", "2025-01-01T00:01:00Z", "synthetic-stage", ""]],
            header=["sleep_id", "start_time", "stage"],
        )
        importer.normalize(self.export, self.state)
        records = self.read_records()
        session = next(row for row in records if row["record_type"] == "sleep")
        self.assertNotIn("stages", session["payload"])
        stage = next(row for row in records if row["record_type"] == "sleep_stage")
        self.assertEqual("session", stage["payload"]["raw"]["sleep_id"])
        self.assertTrue(stage["source_uid"].startswith("derived:"))

    def test_hrv_nested_sidecars_and_proprietary_fields_never_become_rmssd(self):
        directory = self.export / "hrv" / "nested"
        directory.mkdir(parents=True)
        (directory / "bins.json").write_text(
            json.dumps({"extra_data": "child.json", "vendor_bins": [1, 2]})
        )
        (directory / "child.json").write_text(
            json.dumps({"unknown_vendor_schema": [3]})
        )
        self.write(
            "heart_rate_variability",
            [["a", "2025-01-01T00:00:00Z", "hrv/nested/bins.json", ""]],
            header=["datauuid", "start_time", "binning_data"],
        )
        self.write(
            "vitality_score",
            [["v", "2025-01-01T00:00:00Z", "synthetic-vendor-value", ""]],
            header=["datauuid", "start_time", "shrv_value"],
        )
        importer.normalize(self.export, self.state)
        records = self.read_records()
        self.assertNotIn("hrv_rmssd", [row["record_type"] for row in records])
        envelope = next(row for row in records if row["record_type"] == "hrv_envelope")
        self.assertEqual(2, len(envelope["payload"]["sidecars"]))
        score = next(row for row in records if row["record_type"] == "energy_score")
        self.assertIn("shrv_value", score["payload"]["raw"])

    def test_missing_optional_sidecar_parent_survives_and_can_be_enriched_later(self):
        self.write(
            "heart_rate",
            [["a", "2025-01-01T00:00:00Z", "missing.json", ""]],
            header=["datauuid", "start_time", "binning_data"],
        )
        report = importer.normalize(self.export, self.state)
        self.assertEqual(
            (1, 1), (report["normalized"], report["totals"]["missing_sidecars"])
        )
        (self.export / "missing.json").write_text('{"synthetic_bins": []}')
        self.assertEqual(1, importer.normalize(self.export, self.state)["normalized"])
        self.assertEqual(1, importer.normalize(self.export, self.state)["unchanged"])

    def test_large_sidecar_is_private_reference_and_unlinked_chart_is_not_assigned(
        self,
    ):
        raw = json.dumps({"synthetic_bins": [0] * 20000})
        (self.export / "large.json").write_text(raw)
        (self.export / "chart_data.json").write_text("[0,1,2]")
        self.write(
            "movement",
            [["a", "2025-01-01T00:00:00Z", "large.json", ""]],
            header=["datauuid", "start_time", "binning_data"],
        )
        report = importer.normalize(self.export, self.state)
        self.assertEqual(1, report["unlinked_json_assets"])
        asset = self.read_records()[0]["payload"]["sidecars"][0]
        self.assertEqual(raw, (self.state / asset["private_asset"]).read_text())
        self.assertNotIn("raw_json", asset)

    def test_unsafe_sidecar_path_is_rejected_without_losing_parent(self):
        (self.root / "outside.json").write_text('["private-synthetic"]')
        self.write(
            "heart_rate",
            [["a", "2025-01-01T00:00:00Z", "../outside.json", ""]],
            header=["datauuid", "start_time", "binning_data"],
        )
        importer.normalize(self.export, self.state)
        self.assertIn(
            "UNSAFE_SIDECAR_REFERENCE",
            self.read_records()[0]["payload"]["sidecar_issues"],
        )
        self.assertNotIn("sidecars", self.read_records()[0]["payload"])

    def test_extensionless_reference_and_malformed_optional_json(self):
        (self.export / "synthetic-bins.json").write_text("invalid-json")
        self.write(
            "heart_rate",
            [["a", "2025-01-01T00:00:00Z", "synthetic-bins", ""]],
            header=["datauuid", "start_time", "binning_data"],
        )
        report = importer.normalize(self.export, self.state)
        self.assertEqual(1, report["normalized"])
        record = self.read_records()[0]
        self.assertIn("MALFORMED_SIDECAR", record["payload"]["sidecar_issues"])
        self.assertEqual(
            "synthetic-bins", record["payload"]["sidecars"][0]["reference"]
        )

    def test_multiple_step_sources_and_duplicate_calendar_days_remain_independent(self):
        for table in [
            "activity_day_summary",
            "step_daily_trend",
            "pedometer_day_summary",
            "step_count",
        ]:
            self.write(
                table,
                [
                    [
                        table + "-watch",
                        "2025-01-01T00:00:00Z",
                        "synthetic-package",
                        "watch",
                        "",
                    ],
                    [
                        table + "-phone",
                        "2025-01-01T00:00:00Z",
                        "synthetic-package",
                        "phone",
                        "",
                    ],
                ],
            )
        self.assertEqual(8, importer.normalize(self.export, self.state)["normalized"])
        self.assertEqual(8, len(self.read_records()))
        self.assertTrue(
            all(
                row["source_priority"] == 0
                for row in self.read_records()
                if row["record_type"]
                in {"steps", "steps_daily", "pedometer_day_summary", "activity_summary"}
            )
        )

    def test_weight_provenance_all_sources_and_no_exercise_inference(self):
        self.write(
            "weight",
            [
                ["a", "2025-01-01T00:00:00Z", "samsung.synthetic", "scale", ""],
                ["b", "2025-01-01T00:00:00Z", "googlefit.synthetic", "scale", ""],
                ["c", "2025-01-01T00:00:00Z", "fitbit.synthetic", "scale", ""],
            ],
        )
        result = importer.normalize(self.export, self.state)
        self.assertEqual(3, result["datasets"][0]["source_package_count"])
        self.assertEqual("MISSING", result["historical_exercise"])
        self.write(
            "exercise",
            [["e", "2025-01-01T00:00:00Z", "synthetic-package", "watch", ""]],
        )
        self.assertEqual(
            "PRESENT",
            importer.normalize(self.export, self.state)["historical_exercise"],
        )

    def test_unknown_vendor_dataset_and_goal_keep_raw_semantics_without_fake_timestamp(
        self,
    ):
        self.write(
            "unknown_vendor_configuration",
            [["x", "synthetic-setting", ""]],
            header=["datauuid", "setting"],
        )
        self.write("training_load_goal", [["synthetic-goal", ""]], header=["goal"])
        self.assertEqual(2, importer.normalize(self.export, self.state)["normalized"])
        for record in self.read_records():
            self.assertIsNone(record["start_time"])
            self.assertIn(record["record_type"], audited_export.UNDATED)

    def test_canonical_types_agree_with_android_edge_and_postgres(self):
        core = (
            importer.REPO
            / "android/core/src/main/kotlin/com/athleteos/sync/domain/model/HealthRecord.kt"
        ).read_text()
        edge = (
            importer.REPO / "supabase/functions/sync-batch/validation.ts"
        ).read_text()
        sql = (
            importer.REPO / "supabase/migrations/0002_phase1_ingestion.sql"
        ).read_text()
        for kind in set(audited_export.DATASETS.values()) | {"vendor_raw"}:
            self.assertIn('"' + kind + '"', core)
            self.assertIn('"' + kind + '"', edge)
            self.assertIn("'" + kind + "'", sql)

    def test_upload_rejects_account_or_project_switch_without_touching_queue(self):
        self.write(
            "step_count",
            [["synthetic-a", "2025-01-01T00:00:00Z", "synthetic-package", "watch", ""]],
        )
        importer.normalize(self.export, self.state)
        db = importer.open_state(self.state)
        db.execute("insert into metadata values('user_id','synthetic-owner')")
        db.execute(
            "insert into metadata values('project_url','https://example.supabase.co')"
        )
        db.commit()
        db.close()
        for user, project in [
            ("other-owner", "https://example.supabase.co"),
            ("synthetic-owner", "https://other.supabase.co"),
        ]:
            with (
                patch.dict(
                    importer.os.environ, {"ATHLETEOS_ACCESS_TOKEN": "synthetic-token"}
                ),
                patch.object(
                    importer, "request_json", return_value={"id": user}
                ) as request,
            ):
                with self.assertRaises(ValueError):
                    importer.upload(self.state, project, "sb_publishable_synthetic")
                self.assertEqual(1, request.call_count)
        db = importer.open_state(self.state)
        self.assertEqual(
            "PENDING", db.execute("select state from records").fetchone()[0]
        )
        db.close()

    def test_upload_batches_above_500_and_restart_is_idempotent(self):
        self.write(
            "step_count",
            [
                [
                    f"synthetic-{i}",
                    "2025-01-01T00:00:00Z",
                    "synthetic-package",
                    "watch",
                    "",
                ]
                for i in range(1001)
            ],
        )
        importer.normalize(self.export, self.state)
        sizes = []

        def request(url, public_key, body=None, token=None):
            if url.endswith("/user"):
                return {"id": "synthetic-owner"}
            sizes.append(len(body["records"]))
            return {"accepted": len(body["records"]), "runs_accepted": 0}

        with (
            patch.dict(
                importer.os.environ, {"ATHLETEOS_ACCESS_TOKEN": "synthetic-token"}
            ),
            patch.object(importer, "request_json", side_effect=request),
        ):
            self.assertEqual(
                1001,
                importer.upload(
                    self.state,
                    "https://example.supabase.co",
                    "sb_publishable_synthetic",
                )["accepted"],
            )
            self.assertEqual(
                0,
                importer.upload(
                    self.state,
                    "https://example.supabase.co",
                    "sb_publishable_synthetic",
                )["accepted"],
            )
        self.assertEqual([500, 500, 1], sizes)
        self.assertEqual(1001, importer.normalize(self.export, self.state)["unchanged"])


if __name__ == "__main__":
    unittest.main()

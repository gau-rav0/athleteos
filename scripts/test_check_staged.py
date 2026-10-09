"""Repository privacy guard tests. All files and credentials here are invented."""

import contextlib
import io
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import check_staged as scanner


class PrivacyGuardTest(unittest.TestCase):
    def test_generated_and_private_artifacts_are_rejected_case_insensitively(self):
        for name in [
            "web/.next/cache.json", "web/.vercel/project.json",
            "web/test-results/run/trace.json", "web/playwright-report/index.html",
            "web/coverage/result.json", "web/blob-report/report.json",
            "android/.gradle/state.json", "web/dist/index.js",
            "sdk.AAR", "release.APK", "release.aab", "classes.dex",
            "signing.P12", "signing.pfx", "state.sqlite", "state.db-wal",
            "state.sqlite3-shm", "state.sqlite-journal", "capture.har",
            "capture.webm", "capture.mp4", "cache.tsbuildinfo",
            "data.tsv", "archive.7z", "archive.rar", ".ENV.local",
        ]:
            with self.subTest(name=name):
                self.assertEqual("private/generated artifact", scanner.artifact_reason(name))

    def test_source_and_invented_fixture_identifiers_remain_allowed(self):
        for name in ["web/app/page.tsx", "docs/WEB_SECURITY.md", "scripts/test_check_staged.py"]:
            self.assertIsNone(scanner.artifact_reason(name))
        self.assertIsNone(scanner.content_reason("tests/example.ts", b"one@synthetic.example synthetic-device"))
        self.assertIsNone(scanner.content_reason("android/gradle/wrapper/gradle-wrapper.jar", b"\0synthetic"))
        self.assertEqual("unexpected binary", scanner.content_reason("public/capture.png", b"\0synthetic"))

    def test_credentials_are_classified_without_printing_matched_content(self):
        fake = ("sb_secret_" + "a" * 24).encode()
        capture = io.StringIO()
        with contextlib.redirect_stdout(capture):
            self.assertEqual("possible credential", scanner.content_reason("example.ts", fake))
        self.assertEqual("", capture.getvalue())

    def test_staged_content_is_scanned_even_when_working_copy_is_safe(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            (repo / "scripts").mkdir()
            shutil.copyfile(Path(scanner.__file__), repo / "scripts/check_staged.py")
            subprocess.run(["git", "init", "--quiet"], cwd=repo, check=True)
            fake = "sb_secret_" + "a" * 24
            file = repo / "example.ts"
            file.write_text(fake, encoding="utf-8")
            subprocess.run(["git", "add", "example.ts"], cwd=repo, check=True)
            file.write_text("safe source", encoding="utf-8")
            result = subprocess.run([sys.executable, "scripts/check_staged.py"], cwd=repo, capture_output=True, text=True)
            self.assertEqual(1, result.returncode)
            self.assertIn("possible credential", result.stdout)
            self.assertNotIn(fake, result.stdout + result.stderr)

    def test_cleanup_deletion_of_private_artifact_is_allowed(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            (repo / "scripts").mkdir()
            shutil.copyfile(Path(scanner.__file__), repo / "scripts/check_staged.py")
            subprocess.run(["git", "init", "--quiet"], cwd=repo, check=True)
            (repo / "synthetic.apk").write_bytes(b"invented")
            subprocess.run(["git", "add", "synthetic.apk"], cwd=repo, check=True)
            subprocess.run(["git", "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.test", "commit", "--quiet", "-m", "synthetic fixture"], cwd=repo, check=True)
            subprocess.run(["git", "rm", "--quiet", "synthetic.apk"], cwd=repo, check=True)
            result = subprocess.run([sys.executable, "scripts/check_staged.py"], cwd=repo, capture_output=True, text=True)
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()

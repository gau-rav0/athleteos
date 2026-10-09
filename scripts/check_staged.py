"""Fail closed on staged private artifacts and common credentials. Never print matched content."""

import pathlib
import re
import subprocess
import sys

def artifact_reason(name):
    """Classify paths without reading or printing their contents."""
    path = pathlib.PurePosixPath(name)
    if (
        path.suffix.lower()
        in {
            ".aar",
            ".apk",
            ".aab",
            ".dex",
            ".csv",
            ".tsv",
            ".zip",
            ".7z",
            ".rar",
            ".jsonl",
            ".jks",
            ".keystore",
            ".p12",
            ".pfx",
            ".pem",
            ".key",
            ".db",
            ".sqlite",
            ".sqlite3",
            ".log",
            ".hprof",
            ".dmp",
            ".tsbuildinfo",
            ".har",
            ".webm",
            ".mp4",
        }
        or path.name.lower() == "local.properties"
        or path.name.lower().startswith(".env")
        or re.search(r"\.(?:db|sqlite3?)-(?:wal|shm|journal)$", path.name.lower())
        or any(
            part.lower()
            in {
                "build",
                "dist",
                ".gradle",
                ".next",
                ".vercel",
                "coverage",
                "test-results",
                "playwright-report",
                "blob-report",
                "exports",
                "health-export",
                "samsung-health-export",
                "private",
                "import-state",
                "quarantine",
                "node_modules",
            }
            for part in path.parts
        )
    ):
        return "private/generated artifact"
    return None


def content_reason(name, data):
    if b"\0" in data:
        if name != "android/gradle/wrapper/gradle-wrapper.jar":
            return "unexpected binary"
        return None
    text = data.decode("utf-8", errors="replace")
    patterns = [
        r"eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}",
        r"(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}",
        r"sb_secret_[A-Za-z0-9_-]{20,}",
        r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
        r"(?i)(?:password|service_role_key|refresh_token|access_token)\s*[:=]\s*[\"'][A-Za-z0-9+/_.-]{16,}[\"']",
    ]
    if any(re.search(pattern, text) for pattern in patterns):
        return "possible credential"
    return None


def main():
    root = pathlib.Path(__file__).resolve().parents[1]
    all_files = "--all" in sys.argv
    command = (
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"]
        if all_files
        # Deleting an accidentally tracked private file must remain possible.
        else ["git", "diff", "--cached", "--diff-filter=ACMRT", "--name-only", "-z"]
    )
    names = sorted(set(filter(None, subprocess.check_output(command, cwd=root).decode().split("\0"))))
    blocked = []
    for name in names:
        reason = artifact_reason(name)
        if reason:
            blocked.append((name, reason))
            continue
        if all_files:
            actual = root / name
            if actual.is_symlink():
                blocked.append((name, "symlink requires private-path review"))
                continue
            if not actual.is_file():
                continue
            data = actual.read_bytes()
        else:
            entry = subprocess.check_output(["git", "ls-files", "--stage", "--", name], cwd=root)
            if entry.startswith(b"120000 "):
                blocked.append((name, "symlink requires private-path review"))
                continue
            result = subprocess.run(["git", "show", f":{name}"], cwd=root, capture_output=True)
            if result.returncode:
                continue
            data = result.stdout
        reason = content_reason(name, data)
        if reason:
            blocked.append((name, reason))
    if blocked:
        for name, reason in blocked:
            print(f"BLOCKED {name}: {reason}")
        return 1
    print(f"{'Workspace' if all_files else 'Staged'} security check passed ({len(names)} files). Review the staged diff as well.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

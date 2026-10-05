"""Fail closed on staged private artifacts and common credentials. Never print matched content."""
import pathlib
import re
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[1]
names = subprocess.check_output(["git", "diff", "--cached", "--name-only", "-z"], cwd=root).decode().split("\0")
blocked = []
for name in filter(None, names):
    path = pathlib.PurePosixPath(name)
    if (path.suffix.lower() in {".aar", ".csv", ".zip", ".jsonl", ".jks", ".keystore", ".pem", ".key", ".db", ".log"}
        or path.name == "local.properties" or path.name.startswith(".env")
        or any(part.lower() in {"build", "exports", "health-export", "samsung-health-export", "private", "import-state", "quarantine", "node_modules"} for part in path.parts)):
        blocked.append((name, "private/generated artifact"))
        continue
    result = subprocess.run(["git", "show", f":{name}"], cwd=root, capture_output=True)
    if result.returncode:  # deletion
        continue
    data = result.stdout
    if b"\0" in data:
        if name != "android/gradle/wrapper/gradle-wrapper.jar":
            blocked.append((name, "unexpected binary"))
        continue
    text = data.decode("utf-8", errors="replace")
    patterns = [r"eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}",
                r"(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}", r"sb_secret_[A-Za-z0-9_-]{20,}",
                r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
                r"(?i)(?:password|service_role_key|refresh_token|access_token)\s*[:=]\s*[\"'][A-Za-z0-9+/_.-]{16,}[\"']"]
    if any(re.search(pattern, text) for pattern in patterns):
        blocked.append((name, "possible credential"))
if blocked:
    for name, reason in blocked:
        print(f"BLOCKED {name}: {reason}")
    sys.exit(1)
print(f"Staged security check passed ({len(list(filter(None, names)))} files). Review the staged diff as well.")

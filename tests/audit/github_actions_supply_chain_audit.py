#!/usr/bin/env python3
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
PINNED = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*@[0-9a-f]{40}(?:\s+#.*)?$")

failures: list[str] = []
count = 0
for path in sorted(WORKFLOWS.glob("*.yml")):
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = raw.strip()
        if not stripped.startswith("uses:"):
            continue
        value = stripped.split(":", 1)[1].strip()
        if value.startswith("./") or value.startswith("docker://"):
            continue
        count += 1
        if not PINNED.fullmatch(value):
            failures.append(f"{path.relative_to(ROOT)}:{line_number}: {value}")

if failures:
    print("FAIL: unpinned third-party GitHub Actions")
    for failure in failures:
        print(f"  {failure}")
    raise SystemExit(1)

print(f"PASS: {count} third-party GitHub Action references are SHA-pinned")

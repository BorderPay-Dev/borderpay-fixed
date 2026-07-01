#!/usr/bin/env python3
"""
Meta-runner for all Flutterwave audits in this directory.
Fails if any flutterwave_*_audit.py script fails.
"""

from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
AUDIT_DIR = ROOT / "tests" / "audit"


def main() -> int:
    audits = sorted(
        p for p in AUDIT_DIR.glob("flutterwave_*_audit.py")
        if p.name != "flutterwave_suite_runner_audit.py"
    )
    if not audits:
        print("flutterwave_suite_runner_audit: FAIL")
        print(" - no flutterwave_*_audit.py files found")
        return 1

    failures = []
    for script in audits:
        print(f"[RUN] {script.name}")
        result = subprocess.run(
            [sys.executable, str(script)],
            cwd=str(ROOT),
            text=True,
            capture_output=True,
        )
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
        if result.returncode != 0:
            failures.append(script.name)

    if failures:
        print("flutterwave_suite_runner_audit: FAIL")
        for name in failures:
            print(f" - failed: {name}")
        return 1

    print("flutterwave_suite_runner_audit: PASS")
    print(f" - total audits: {len(audits)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())


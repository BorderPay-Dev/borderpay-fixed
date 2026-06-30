#!/usr/bin/env python3
"""
RC1 freeze rule audit (deployment-blocking).

If RC1 business certification is incomplete, block parallel implementation work on:
- FX
- Payroll
- Affiliate financial lifecycle
- Mobile release tracks

The freeze is enforced by scanning changed files in the current branch/working tree.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RC1_GATE = ROOT / "tests" / "audit" / "rc1_business_certification_gate_audit.py"

BLOCKED_PREFIXES = (
    "utils/fx/",
    "components/exchange/",
    "components/business/Payroll",
    "components/business/BulkPayout",
    "components/referral/",
    "utils/affiliate/",
    "android/",
    "ios/",
)
BLOCKED_EXACT = {
    "capacitor.config.ts",
    "AFFILIATE_CAPABILITY_MATRIX.md",
}
BLOCKED_DOC_TOKENS = (
    "APPSTORE",
    "PLAYSTORE",
    "AFFILIATE",
    "PAYROLL",
    "FX_",
)
MOBILE_WORKFLOW_TOKENS = ("testflight", "play store", "google play", "app store", "fastlane", "pilot")
ALLOWED_WHEN_FROZEN_PREFIXES = (
    "tests/audit/",
    "artifacts/business-certification/",
    "docs/PREDEPLOY_GATE_REPORT_",
    "RC1_BUSINESS_CERTIFICATION_REPORT.md",
)


def run(cmd: str) -> tuple[int, str, str]:
    p = subprocess.run(["/bin/zsh", "-lc", f"cd {ROOT} && {cmd}"], text=True, capture_output=True)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def certification_complete() -> bool:
    rc, _, _ = run(f"python3 {RC1_GATE}")
    return rc == 0


def changed_files() -> list[str]:
    for ref in ("origin/main", "main", "origin/master", "master"):
        rc, _, _ = run(f"git rev-parse --verify {ref}")
        if rc != 0:
            continue
        rc, base, _ = run(f"git merge-base HEAD {ref}")
        if rc != 0 or not base:
            continue
        rc, out, _ = run(f"git diff --name-only {base}...HEAD")
        if rc == 0:
            files = [ln.strip() for ln in out.splitlines() if ln.strip()]
            if files:
                return files

    rc, out, _ = run("git status --porcelain")
    if rc != 0:
        return []
    files: list[str] = []
    for line in out.splitlines():
        if not line.strip():
            continue
        path = line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[1].strip()
        if path:
            files.append(path)
    return files


def blocked_file(path: str) -> bool:
    if path in BLOCKED_EXACT:
        return True
    if any(path.startswith(prefix) for prefix in ALLOWED_WHEN_FROZEN_PREFIXES):
        return False
    if any(path.startswith(prefix) for prefix in BLOCKED_PREFIXES):
        return True
    if path.startswith("docs/") and any(tok in Path(path).name.upper() for tok in BLOCKED_DOC_TOKENS):
        return True
    if path.startswith(".github/workflows/"):
        wf = ROOT / path
        if wf.is_file():
            txt = wf.read_text(encoding="utf-8").lower()
            return any(tok in txt for tok in MOBILE_WORKFLOW_TOKENS)
    return False


def main() -> int:
    if certification_complete():
        print("[OK] RC1 certification complete; freeze rule inactive")
        print("\nrc1_freeze_rule_audit: PASS")
        return 0

    files = changed_files()
    offenders = sorted({f for f in files if blocked_file(f)})

    if offenders:
        print("[FAIL] RC1 certification incomplete: blocked domains changed")
        for f in offenders[:120]:
            print(f"  - {f}")
        print("\nrc1_freeze_rule_audit: FAIL")
        return 1

    print("[OK] RC1 certification incomplete; no blocked FX/Payroll/Affiliate/Mobile changes detected")
    print("\nrc1_freeze_rule_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Regression audit for user-facing KYC/account access status separation."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
MAPPER = (ROOT / "utils/accountAccessStatus.ts").read_text(encoding="utf-8")
MAIN = (ROOT / "components/app/MainApp.tsx").read_text(encoding="utf-8")

checks = {
    "rejected maps to verification wording": (
        "return 'verification_rejected';" in MAPPER
        and "title: 'Verification rejected'" in MAIN
    ),
    "rejected cannot map directly to frozen": (
        "FROZEN = new Set(['frozen', 'compliance_hold', 'compliance_frozen'])" in MAPPER
        and "'rejected'" not in MAPPER.split("const FROZEN", 1)[1].split(";", 1)[0]
    ),
    "paused has distinct restricted wording": (
        "return 'paused';" in MAPPER and "title: 'Account paused'" in MAIN
    ),
    "offboarded maps to closed": (
        "'offboarded'" in MAPPER and "return 'closed';" in MAPPER and "title: 'Account closed'" in MAIN
    ),
    "Bridge review statuses have exact user-safe labels": all(label in MAIN for label in (
        "title: 'Under review'",
        "title: 'More information needed'",
        "title: 'Additional review required'",
        "title: 'Business ownership details required'",
        "title: 'Verification incomplete'",
    )),
    "individual and business use shared mapper": (
        "deriveAccountAccessState(profile)" in MAIN
        and "bridge_kyc_status" in MAPPER
        and "bridge_kyb_status" in MAPPER
    ),
}

failed = []
for name, passed in checks.items():
    print(f"[{'OK' if passed else 'FAIL'}] {name}")
    if not passed:
        failed.append(name)

if failed:
    print(f"\naccount_status_display_mapping_audit: FAIL ({len(failed)} checks)")
    sys.exit(1)

cases = ROOT / "tests/audit/account_status_display_mapping_cases.ts"
result = subprocess.run(["node", "--import", "tsx", str(cases)], cwd=ROOT, text=True, capture_output=True)
if result.stdout:
    print(result.stdout.rstrip())
if result.returncode != 0:
    if result.stderr:
        print(result.stderr.rstrip())
    print("\naccount_status_display_mapping_audit: FAIL (runtime mapping cases)")
    sys.exit(1)

print(f"\naccount_status_display_mapping_audit: PASS ({len(checks)} structural + runtime cases)")

#!/usr/bin/env python3
"""
Retired funding gate audit.

The old provider-balance funding gate is intentionally removed from production.
This audit fails if the helper or any direct imports come back.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GATE = ROOT / "supabase/functions/_shared/funding-gate.ts"

failures: list[str] = []

if GATE.exists():
    failures.append("funding-gate.ts must not exist")

for path in (ROOT / "supabase/functions").rglob("*.ts"):
    src = path.read_text(encoding="utf-8")
    if "funding-gate.ts" in src or "requireMinimumWalletBalance" in src:
        failures.append(f"{path.relative_to(ROOT)} imports or references the retired funding gate")

if failures:
    print("RETIRED FUNDING GATE AUDIT: FAIL")
    for failure in failures:
        print(f"  ✗ {failure}")
    sys.exit(1)

print("RETIRED FUNDING GATE AUDIT: PASS")
print("  ✓ funding gate helper and imports are absent")

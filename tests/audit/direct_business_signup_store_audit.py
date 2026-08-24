#!/usr/bin/env python3
"""Fail closed if the direct store signup can submit an Individual account."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "components/auth/SignUpFlow.tsx").read_text(encoding="utf-8")

required = (
    "accountType: 'business'",
    "const accountType = 'business' as const",
    "The public BorderPay mobile app is a direct Business signup channel.",
    "<Building className=\"w-4 h-4\" /> Business",
)
for marker in required:
    if marker not in SOURCE:
        raise SystemExit(f"FAIL: missing direct Business signup marker: {marker}")

for forbidden in (
    "onClick={() => updateForm({ accountType: 'individual' })}",
    "<User className=\"w-4 h-4\" /> Individual",
    "account_type: formData.accountType",
):
    if forbidden in SOURCE:
        raise SystemExit(f"FAIL: direct Individual signup remains reachable: {forbidden}")

print("Direct Business-only store signup audit passed")

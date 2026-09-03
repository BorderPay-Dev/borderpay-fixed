#!/usr/bin/env python3
"""Fail closed if direct store signup can create an Individual account."""

from pathlib import Path


root = Path(__file__).resolve().parents[2]
source = (root / "components/auth/SignUpFlow.tsx").read_text()

required = (
    "accountType: 'business'",
    "const accountType = 'business' as const",
    "Direct BorderPay signup is Business-only",
    '<Building className="w-4 h-4" /> Business',
)
for marker in required:
    assert marker in source, f"missing Business-only signup marker: {marker}"

for forbidden in (
    "onClick={() => updateForm({ accountType: 'individual' })}",
    '<User className="w-4 h-4" /> Individual',
    "account_type: formData.accountType",
):
    assert forbidden not in source, f"direct Individual signup remains reachable: {forbidden}"

print("Direct Business-only store signup audit: PASS")

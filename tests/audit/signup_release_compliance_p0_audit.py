#!/usr/bin/env python3
"""Release gate for the public BorderPay signup compliance surface."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
signup = (ROOT / "components/auth/SignUpFlow.tsx").read_text()
countries = (ROOT / "src/lib/countries.ts").read_text()

checks = {
    "public signup defaults to Business": "accountType: 'business'" in signup,
    "submitted account type is immutable Business": "const accountType = 'business' as const" in signup,
    "Individual selector is absent": '<User className="w-4 h-4" /> Individual' not in signup,
    "signup has exactly two visible steps": "const steps: SignUpStep[] = ['personal', 'confirm-email'];" in signup and "const totalSteps = 2;" in signup,
    "country list follows Bridge blocked policy": "isBridgeBlocked(code) || code === 'UA'" in countries,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit(f"{len(failed)} signup compliance checks failed")
print(f"PASS: {len(checks)}/{len(checks)} signup compliance checks")

#!/usr/bin/env python3
"""
No deposit/activation unlock gate audit.

Production rule:
  - no paid-plan gate,
  - no minimum-wallet-balance gate,
  - no first-transfer/deposit unlock gate.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

FILES = [
    ROOT / "supabase/functions/bridge-transfer/index.ts",
    ROOT / "supabase/functions/bridge-bulk-payout/index.ts",
    ROOT / "supabase/functions/bridge-wallet/index.ts",
    ROOT / "supabase/functions/bridge-external-account/index.ts",
    ROOT / "supabase/functions/bridge-virtual-account/index.ts",
    ROOT / "supabase/functions/bridge-customer/index.ts",
    ROOT / "supabase/functions/bridge-kyc-link/index.ts",
    ROOT / "supabase/functions/bridge-kyb-link/index.ts",
    ROOT / "components/app/MainApp.tsx",
    ROOT / "utils/api/backendAPI.ts",
]

FORBIDDEN = [
    "requireMinimumWalletBalance",
    "funding_required",
    "payment_required",
    "plan_required",
    "KYC_REQUIRES_PAYMENT",
    "PAID_PLAN_KEYS",
    "first transfer or deposit",
    "deposit to unlock",
    "unlock global accounts",
    "unlock global virtual accounts",
]

failures: list[str] = []

for path in FILES:
    if not path.exists():
        failures.append(f"MISSING FILE: {path.relative_to(ROOT)}")
        continue
    src = path.read_text(encoding="utf-8").lower()
    for token in FORBIDDEN:
        if token.lower() in src:
            failures.append(f"{path.relative_to(ROOT)} contains forbidden gate token: {token}")

for removed in [
    ROOT / "supabase/functions/_shared/funding-gate.ts",
    ROOT / "supabase/functions/_shared/plan-gate.ts",
]:
    if removed.exists():
        failures.append(f"Retired gate helper still exists: {removed.relative_to(ROOT)}")

if failures:
    print("NO DEPOSIT/ACTIVATION UNLOCK GATE AUDIT: FAIL")
    for failure in failures:
        print(f"  ✗ {failure}")
    sys.exit(1)

print("NO DEPOSIT/ACTIVATION UNLOCK GATE AUDIT: PASS")
print("  ✓ no paid-plan/minimum-balance/first-transaction unlock gates in live flows")

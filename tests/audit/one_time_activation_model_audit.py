#!/usr/bin/env python3
"""
No one-time activation model audit.

BorderPay production no longer has paid plans, activation fees, or
minimum-deposit unlocks. This audit protects that rule in active app and Edge
Function paths.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

FILES = [
    ROOT / "utils/subscriptions/gate.ts",
    ROOT / "supabase/functions/_shared/launch-gates.ts",
    ROOT / "supabase/functions/bridge-virtual-account/index.ts",
    ROOT / "supabase/functions/bridge-wallet/index.ts",
    ROOT / "supabase/functions/bridge-external-account/index.ts",
    ROOT / "supabase/functions/bridge-transfer/index.ts",
    ROOT / "components/business/BulkPayoutScreen.tsx",
    ROOT / "components/wallets/ExternalWalletsScreen.tsx",
    ROOT / "components/app/MainApp.tsx",
]

FORBIDDEN = [
    "activation_fee_usd",
    "PAID_PLAN_KEYS",
    "KYC_REQUIRES_PAYMENT",
    "requireMinimumWalletBalance",
    "funding_required",
    "payment_required",
    "plan_required",
    "Activate to unlock",
    "minimum funding requirement",
]

failures: list[str] = []

for path in FILES:
    if not path.exists():
        failures.append(f"MISSING FILE: {path.relative_to(ROOT)}")
        continue
    src = path.read_text(encoding="utf-8")
    for token in FORBIDDEN:
        if token in src:
            failures.append(f"{path.relative_to(ROOT)} contains retired activation token: {token}")

if failures:
    print("NO ONE-TIME ACTIVATION MODEL AUDIT: FAIL")
    for failure in failures:
        print(f"  ✗ {failure}")
    sys.exit(1)

print("NO ONE-TIME ACTIVATION MODEL AUDIT: PASS")
print("  ✓ no paid-plan, activation-fee, or minimum-deposit gate in active flows")

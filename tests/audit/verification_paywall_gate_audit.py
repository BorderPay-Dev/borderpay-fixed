#!/usr/bin/env python3
"""
Verification gate audit, fail-closed.

KYC/KYB is AUTOMATIC: Bridge runs verification and we react to its webhook.
There is NO admin manual-review step. This audit locks that model:

  V1  launch-gates.ts defines verificationGate + loadVerificationContext +
      PAID_PLAN_KEYS (free tiers excluded) + payment_required + kycRequiresPayment.
  V2  The 3 billable Bridge entry points (bridge-customer, bridge-kyc-link,
      bridge-kyb-link) call verificationGate(loadVerificationContext(...)) AND
      keep the outer env pause (bridgeOnboardingEnabled).
  V3  The admin manual-review gate is GONE — launch-gates.ts no longer references
      pending_manual_review / VERIFICATION_AUTHORIZED / reviewStatus, so KYC/KYB
      can never be blocked behind admin authorization again.
  V4  Frontend gate.ts exposes canMoveMoney / canStartVerification / isPaidPlanKey.

Text-parsing, dependency-free. Exits non-zero on any violation.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GATE = ROOT / "supabase/functions/_shared/launch-gates.ts"
BRIDGE_FNS = [
    ROOT / "supabase/functions/bridge-customer/index.ts",
    ROOT / "supabase/functions/bridge-kyc-link/index.ts",
    ROOT / "supabase/functions/bridge-kyb-link/index.ts",
]
FE_GATE = ROOT / "utils/subscriptions/gate.ts"

failures: list[str] = []


def read(p: Path) -> str:
    if not p.exists():
        failures.append(f"MISSING FILE: {p.relative_to(ROOT)}")
        return ""
    return p.read_text(encoding="utf-8")


gate = read(GATE)
fe = read(FE_GATE)

# V1 ----------------------------------------------------------------------
if gate:
    for tok in ['export function verificationGate', 'payment_required',
                'PAID_PLAN_KEYS', 'export async function loadVerificationContext',
                'export function kycRequiresPayment']:
        if tok not in gate:
            failures.append(f"V1 launch-gates.ts missing '{tok}'")
    paid_block = re.search(r"PAID_PLAN_KEYS[^\]]*?new Set\(\[(.*?)\]\)", gate, re.S)
    body = paid_block.group(1) if paid_block else ""
    for paid in ["individual_activated", "business_activated"]:
        if paid not in body:
            failures.append(f"V1 PAID_PLAN_KEYS missing activated plan {paid}")
    for free in ["individual_starter", "business_starter"]:
        if free in body:
            failures.append(f"V1 PAID_PLAN_KEYS must NOT include free plan {free}")

# V2 ----------------------------------------------------------------------
for f in BRIDGE_FNS:
    s = read(f)
    if not s:
        continue
    name = f.parent.name
    if "verificationGate(await loadVerificationContext(supa, user.id))" not in s:
        failures.append(f"V2 {name} does not enforce verificationGate(loadVerificationContext)")
    if "bridgeOnboardingEnabled" not in s:
        failures.append(f"V2 {name} dropped the outer env pause (bridgeOnboardingEnabled)")

# V3 ----------------------------------------------------------------------
# Automatic KYC/KYB — the manual-review gate must be gone from launch-gates.ts.
if gate:
    for banned in ["pending_manual_review", "VERIFICATION_AUTHORIZED", "reviewStatus"]:
        if banned in gate:
            failures.append(f"V3 launch-gates.ts still references manual-review token '{banned}' (KYC must be automatic, no admin gate)")

# V4 ----------------------------------------------------------------------
if fe:
    for tok in ["canMoveMoney", "canStartVerification", "isPaidPlanKey"]:
        if tok not in fe:
            failures.append(f"V4 frontend gate.ts missing {tok}")

# Report -------------------------------------------------------------------
if failures:
    print("VERIFICATION GATE AUDIT: FAIL")
    for f in failures:
        print(f"  ✗ {f}")
    sys.exit(1)

print("VERIFICATION GATE AUDIT: PASS (4/4)")
print("  ✓ V1 verificationGate + loader + PAID_PLAN_KEYS (free excluded) + payment + kycRequiresPayment")
print("  ✓ V2 all 3 Bridge entry points gate behind env pause + (optional) payment")
print("  ✓ V3 admin manual-review gate removed — KYC/KYB is automatic via webhook")
print("  ✓ V4 frontend gate helpers present")

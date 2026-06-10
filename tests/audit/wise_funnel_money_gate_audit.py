#!/usr/bin/env python3
"""
Wise-funnel money-gate audit, fail-closed.

Encodes the "free KYC → pay on money movement" model so it can't silently
regress:

  W1  launch-gates.ts exports kycRequiresPayment() (env KYC_REQUIRES_PAYMENT,
      default TRUE = current pay->KYC), requireActivatedPlan(), and
      PLAN_REQUIRED_CODE.
  W2  verificationGate's payment_required step is GUARDED by kycRequiresPayment()
      — so KYC/KYB becomes free when the env flips, without code changes.
  W3  Every money-movement function is paid-gated:
        - bridge-transfer / bridge-wallet / bridge-external-account call
          requireActivatedPlan(...)
        - bridge-virtual-account keeps its inline plan_required activation gate.
  W4  The default stays safe: kycRequiresPayment defaults to TRUE (production
      behavior unchanged until the operator sets KYC_REQUIRES_PAYMENT=false).

Text-parsing, dependency-free. Exits non-zero on any violation.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GATE = ROOT / "supabase/functions/_shared/launch-gates.ts"
PLAN_GATE = ROOT / "supabase/functions/_shared/plan-gate.ts"
TRANSFER = ROOT / "supabase/functions/bridge-transfer/index.ts"
WALLET = ROOT / "supabase/functions/bridge-wallet/index.ts"
EXTACCT = ROOT / "supabase/functions/bridge-external-account/index.ts"
VA = ROOT / "supabase/functions/bridge-virtual-account/index.ts"

failures: list[str] = []


def read(p: Path) -> str:
    if not p.exists():
        failures.append(f"MISSING FILE: {p.relative_to(ROOT)}")
        return ""
    return p.read_text(encoding="utf-8")


gate = read(GATE)
plan_gate = read(PLAN_GATE)

# W1 ----------------------------------------------------------------------
# kycRequiresPayment lives in launch-gates (KYC/onboarding scope).
for tok in ["export function kycRequiresPayment", "KYC_REQUIRES_PAYMENT"]:
    if tok not in gate:
        failures.append(f"W1 launch-gates.ts missing '{tok}'")
# The paid gate lives in its OWN module (plan-gate.ts) so money functions never
# import the onboarding-pause module (see bridge_onboarding_pause_and_header P4).
for tok in ["export async function requireActivatedPlan", "PLAN_REQUIRED_CODE"]:
    if tok not in plan_gate:
        failures.append(f"W1 plan-gate.ts missing '{tok}'")

# W2 ----------------------------------------------------------------------
# The payment_required branch inside verificationGate must be guarded by
# kycRequiresPayment() so freeing KYC is a pure env flip.
if gate and not re.search(r"kycRequiresPayment\(\)\s*&&\s*!input\.isPaidPlan", gate):
    failures.append("W2 verificationGate payment step is not guarded by kycRequiresPayment()")

# W3 ----------------------------------------------------------------------
for name, path in [("bridge-transfer", TRANSFER),
                   ("bridge-wallet", WALLET),
                   ("bridge-external-account", EXTACCT)]:
    s = read(path)
    if not s:
        continue
    if "requireActivatedPlan(" not in s:
        failures.append(f"W3 {name} does not call requireActivatedPlan() (money not paid-gated)")
    if 'plan-gate.ts"' not in s:
        failures.append(f"W3 {name} does not import requireActivatedPlan from plan-gate.ts")
    # Money functions must NOT import the onboarding-pause module.
    if 'launch-gates.ts"' in s:
        failures.append(f"W3 {name} must not import launch-gates.ts (onboarding pause must not bleed into money movement)")

va = read(VA)
if va and 'code:    "plan_required"' not in va and '"plan_required"' not in va:
    failures.append("W3 bridge-virtual-account lost its plan_required activation gate")

# W4 ----------------------------------------------------------------------
# Default must be TRUE: the helper returns true unless the env is exactly
# 'false'. Assert the safe default literal is present.
if gate and 'KYC_REQUIRES_PAYMENT") || "true"' not in gate:
    failures.append("W4 kycRequiresPayment default is not fail-safe TRUE")

# Report -------------------------------------------------------------------
if failures:
    print("WISE FUNNEL MONEY-GATE AUDIT: FAIL")
    for f in failures:
        print(f"  ✗ {f}")
    sys.exit(1)

print("WISE FUNNEL MONEY-GATE AUDIT: PASS (4/4)")
print("  ✓ W1 launch-gates exports kycRequiresPayment + requireActivatedPlan + PLAN_REQUIRED_CODE")
print("  ✓ W2 verificationGate payment step guarded by kycRequiresPayment()")
print("  ✓ W3 transfer/wallet/external-account paid-gated; virtual-account keeps its gate")
print("  ✓ W4 default stays fail-safe (payment required) until env flip")

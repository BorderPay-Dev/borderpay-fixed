#!/usr/bin/env python3
"""
Wise-funnel money-gate audit, fail-closed.

Reflects the CURRENT (2026-06) model: BorderPay no longer charges an
activation fee. The money gate is a minimum WALLET BALANCE (in-repo at
_shared/funding-gate.ts) — funds are NOT deducted, they stay the user's.

  W1  funding-gate.ts exports requireMinimumWalletBalance() + FUNDING_REQUIRED_CODE
      + a non-zero MIN_WALLET_BALANCE_USD.
  W2  launch-gates.ts still exports kycRequiresPayment() and verificationGate's
      payment_required branch is guarded by it (KYC-paywall is an env-flip
      historical knob; still required to live in source).
  W3  Every money-movement function gates on requireMinimumWalletBalance() and
      imports it from funding-gate.ts. Money fns must NOT import
      launch-gates.ts (onboarding pause must never bleed into money movement).
  W4  bridge-virtual-account no longer returns the old `plan_required` activation
      copy — it gates on funding too.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GATE = ROOT / "supabase/functions/_shared/launch-gates.ts"
FUNDING_GATE = ROOT / "supabase/functions/_shared/funding-gate.ts"
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
funding_gate = read(FUNDING_GATE)

# W1 ----------------------------------------------------------------------
for tok in ["export async function requireMinimumWalletBalance", "FUNDING_REQUIRED_CODE", "MIN_WALLET_BALANCE_USD"]:
    if tok not in funding_gate:
        failures.append(f"W1 funding-gate.ts missing '{tok}'")
m = re.search(r"MIN_WALLET_BALANCE_USD\s*=\s*(\d+)", funding_gate)
if not m or int(m.group(1)) <= 0:
    failures.append("W1 MIN_WALLET_BALANCE_USD must be a positive integer")

# W2 ----------------------------------------------------------------------
for tok in ["export function kycRequiresPayment", "KYC_REQUIRES_PAYMENT"]:
    if tok not in gate:
        failures.append(f"W2 launch-gates.ts missing '{tok}'")
if gate and not re.search(r"kycRequiresPayment\(\)\s*&&\s*!input\.isPaidPlan", gate):
    failures.append("W2 verificationGate payment step is not guarded by kycRequiresPayment()")

# W3 ----------------------------------------------------------------------
for name, path in [("bridge-transfer", TRANSFER),
                   ("bridge-wallet", WALLET),
                   ("bridge-external-account", EXTACCT),
                   ("bridge-virtual-account", VA)]:
    s = read(path)
    if not s:
        continue
    if "requireMinimumWalletBalance(" not in s:
        failures.append(f"W3 {name} does not call requireMinimumWalletBalance() (money not funding-gated)")
    if 'funding-gate.ts"' not in s:
        failures.append(f"W3 {name} does not import requireMinimumWalletBalance from funding-gate.ts")
    if 'launch-gates.ts"' in s:
        failures.append(f"W3 {name} must not import launch-gates.ts (onboarding pause must not bleed into money movement)")
    # No stale activation-fee imports.
    if "requireActivatedPlan(" in s:
        failures.append(f"W3 {name} still calls retired requireActivatedPlan()")

# W4 ----------------------------------------------------------------------
va = read(VA)
if va and "Activate your account to open" in va:
    failures.append("W4 bridge-virtual-account still carries the old activation-fee copy")

# Report -------------------------------------------------------------------
if failures:
    print("WISE FUNNEL MONEY-GATE AUDIT: FAIL")
    for f in failures:
        print(f"  ✗ {f}")
    sys.exit(1)

print("WISE FUNNEL MONEY-GATE AUDIT: PASS (4/4)")
print("  ✓ W1 funding-gate exports requireMinimumWalletBalance + FUNDING_REQUIRED_CODE")
print("  ✓ W2 launch-gates kycRequiresPayment still guards the payment step")
print("  ✓ W3 transfer/wallet/external-account/virtual-account funding-gated; no launch-gates import")
print("  ✓ W4 bridge-virtual-account no longer carries the old activation copy")

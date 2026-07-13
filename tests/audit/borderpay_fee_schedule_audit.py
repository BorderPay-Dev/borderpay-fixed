#!/usr/bin/env python3
"""
BorderPay fee-schedule audit (fail-closed).

Guards the money-math invariants for the BorderPay fee schedule:

  F1  Edge canonical schedule exists with the Bridge developer-fee rates
      (virtual-account fiat 2.5%, external-account off-ramp 1.0%).
      USDT 0.999 is a fixed trade rate, not a developer fee.
  F2  Edge African payout markup table carries the correct per-plan numbers
      (individual_starter 1.0, business_starter 0.75, premium/growth 0.5,
      enterprise 0.5).
  F3  Frontend mirror exists and carries byte-identical numbers to the edge
      module (display can never drift from what the server charges).
  F4  bridge-transfer enforces the developer fee SERVER-SIDE: it imports
      bridgeDeveloperFeePercent and passes a computed developer_fee percentage.
  F5  bridge-transfer NO LONGER trusts a client-supplied developer_fee
      (no `developer_fee: body.developer_fee`).

Text-parsing, dependency-free. Exits non-zero on any violation.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EDGE = ROOT / "supabase/functions/_shared/fees/schedule.ts"
FRONT = ROOT / "utils/fees/schedule.ts"
XFER = ROOT / "supabase/functions/bridge-transfer/index.ts"

failures: list[str] = []


def read(p: Path) -> str:
    if not p.exists():
        failures.append(f"MISSING FILE: {p.relative_to(ROOT)}")
        return ""
    return p.read_text(encoding="utf-8")


def num_after(text: str, key: str):
    """Return float value for `key:` <number> (commas/spacing tolerant)."""
    m = re.search(rf"{re.escape(key)}\s*:\s*([0-9]+(?:\.[0-9]+)?)", text)
    return float(m.group(1)) if m else None


edge = read(EDGE)
front = read(FRONT)
xfer = read(XFER)

# Canonical expected numbers ------------------------------------------------
DEV_FEE = {"virtual_account_fiat": 2.5, "external_account_offramp": 1.0}
FIXED_TRADE_RATE = {"USDT": 0.999}
PAYOUT = {
    "individual_starter": 1.0,
    "individual_premium": 0.5,
    "business_starter": 0.75,
    "business_growth": 0.5,
    "business_enterprise": 0.5,
}

# F1 -----------------------------------------------------------------------
if edge:
    for k, v in DEV_FEE.items():
        got = num_after(edge, k)
        if got != v:
            failures.append(f"F1 edge BRIDGE_DEVELOPER_FEE_PERCENT.{k}: expected {v}, got {got}")
    for k, v in FIXED_TRADE_RATE.items():
        got = num_after(edge, k)
        if got != v:
            failures.append(f"F1 edge BRIDGE_FIXED_TRADE_RATE.{k}: expected {v}, got {got}")

# F2 -----------------------------------------------------------------------
if edge:
    for k, v in PAYOUT.items():
        got = num_after(edge, k)
        if got != v:
            failures.append(f"F2 edge AFRICAN_PAYOUT_MARKUP {k}: expected {v}, got {got}")

# F3 — frontend mirror identical ------------------------------------------
if front:
    for k, v in {**DEV_FEE, **FIXED_TRADE_RATE, **PAYOUT}.items():
        got = num_after(front, k)
        if got != v:
            failures.append(f"F3 frontend mirror {k}: expected {v}, got {got}")

# F4 — server-side enforcement --------------------------------------------
if xfer:
    if "BRIDGE_DEVELOPER_FEE_PERCENT.external_account_offramp" not in xfer:
        failures.append("F4 bridge-transfer does not use the server external-account off-ramp developer fee")
    if not re.search(r"developer_fee\s*:\s*isCryptoPayout[\s\S]*external_account_offramp", xfer):
        failures.append("F4 bridge-transfer does not pass server-computed external-account developer_fee percentage")

# F5 — client value no longer trusted -------------------------------------
if xfer:
    if re.search(r"developer_fee\s*:\s*body\.developer_fee", xfer):
        failures.append("F5 bridge-transfer still forwards client-supplied body.developer_fee")

# Report -------------------------------------------------------------------
total = 5
if failures:
    print("FEE SCHEDULE AUDIT: FAIL")
    for f in failures:
        print(f"  ✗ {f}")
    sys.exit(1)

print(f"FEE SCHEDULE AUDIT: PASS ({total}/{total})")
print("  ✓ F1 edge Bridge dev fee 2.5% VA / 1.0% external-account off-ramp; 0.999 USDT fixed rate is separate")
print("  ✓ F2 edge African payout markup tiers (1.0/0.75 starter, 0.5 premium/growth/ent)")
print("  ✓ F3 frontend mirror numbers identical to edge")
print("  ✓ F4 bridge-transfer enforces developer fee server-side")
print("  ✓ F5 bridge-transfer ignores client-supplied developer_fee")

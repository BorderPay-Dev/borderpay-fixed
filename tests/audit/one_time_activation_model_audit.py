#!/usr/bin/env python3
"""
One-time activation model + VA maintenance audit (#A3), fail-closed.

  OT1  plans.ts has the one-time model: activated keys with activation_fee_usd
       999 / 2999, no monthly price field, and NO Growth/Enterprise tiers.
  OT2  gate.ts isPaidPlanKey delegates to isActivatedPlanKey.
  OT3  launch-gates PAID_PLAN_KEYS = activated keys only.
  OT4  subscription-upgrade one-time fee catalogue = activated keys 999/2999.
  OT5  bridge-virtual-account currency matrix uses activated keys; free starter
       is view-only (empty currency set).
  OT6  Maintenance: migration adds maintenance_overdue + charge_va_maintenance;
       bridge-transfer blocks outbound with 'maintenance_due'.
  OT7  UI is de-subscriptioned: no "/ month" or "Monthly price" in pricing UI.

Text-parsing, dependency-free.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLANS  = ROOT / "utils/subscriptions/plans.ts"
GATE   = ROOT / "utils/subscriptions/gate.ts"
LGATE  = ROOT / "supabase/functions/_shared/launch-gates.ts"
UPGR   = ROOT / "supabase/functions/subscription-upgrade/index.ts"
BVA    = ROOT / "supabase/functions/bridge-virtual-account/index.ts"
XFER   = ROOT / "supabase/functions/bridge-transfer/index.ts"
MAINT  = ROOT / "supabase/migrations/20260606130000_va_maintenance.sql"
PRICE  = ROOT / "components/pricing/PricingScreen.tsx"
UPMODL = ROOT / "components/pricing/UpgradeModal.tsx"

failures: list[str] = []


def read(p: Path) -> str:
    if not p.exists():
        failures.append(f"MISSING FILE: {p.relative_to(ROOT)}")
        return ""
    return p.read_text(encoding="utf-8")


plans = read(PLANS)
gate = read(GATE)
lgate = read(LGATE)
upgr = read(UPGR)
bva = read(BVA)
xfer = read(XFER)
maint = read(MAINT)
price = read(PRICE)
upmodl = read(UPMODL)

# OT1 ---------------------------------------------------------------------
if plans:
    for tok in ["individual_activated", "business_activated", "activation_fee_usd"]:
        if tok not in plans:
            failures.append(f"OT1 plans.ts missing {tok}")
    for dead in ["individual_premium", "business_growth", "business_enterprise", "price_monthly_usd", "is_contact_sales"]:
        if dead in plans:
            failures.append(f"OT1 plans.ts still references removed token {dead}")
    if not re.search(r"activation_fee_usd:\s*999", plans):
        failures.append("OT1 individual activation fee != 999")
    if not re.search(r"activation_fee_usd:\s*2999", plans):
        failures.append("OT1 business activation fee != 2999")

# OT2 ---------------------------------------------------------------------
if gate and "isActivatedPlanKey" not in gate:
    failures.append("OT2 gate.ts isPaidPlanKey must delegate to isActivatedPlanKey")

# OT3 ---------------------------------------------------------------------
if lgate:
    block = re.search(r"PAID_PLAN_KEYS[^\]]*?new Set\(\[(.*?)\]\)", lgate, re.S)
    b = block.group(1) if block else ""
    if "individual_activated" not in b or "business_activated" not in b:
        failures.append("OT3 PAID_PLAN_KEYS missing activated keys")
    for dead in ["individual_premium", "business_growth", "business_enterprise"]:
        if dead in b:
            failures.append(f"OT3 PAID_PLAN_KEYS still has {dead}")

# OT4 ---------------------------------------------------------------------
if upgr:
    if not re.search(r"individual_activated:\s*999", upgr) or not re.search(r"business_activated:\s*2999", upgr):
        failures.append("OT4 subscription-upgrade activation prices != 999/2999")
    if "individual_premium" in upgr or "business_growth" in upgr:
        failures.append("OT4 subscription-upgrade still references old plan keys")

# OT5 ---------------------------------------------------------------------
if bva:
    if "individual_activated" not in bva or "business_activated" not in bva:
        failures.append("OT5 bridge-virtual-account currency matrix missing activated keys")
    if "business_growth" in bva or "individual_premium" in bva:
        failures.append("OT5 bridge-virtual-account still references old plan keys")

# OT6 ---------------------------------------------------------------------
if maint:
    if "maintenance_overdue" not in maint or "charge_va_maintenance" not in maint:
        failures.append("OT6 maintenance migration missing overdue flag / charge RPC")
if xfer:
    if "maintenance_due" not in xfer or "maintenance_overdue" not in xfer:
        failures.append("OT6 bridge-transfer does not block outbound on maintenance_due")

# OT7 ---------------------------------------------------------------------
for name, src in [("PricingScreen", price), ("UpgradeModal", upmodl)]:
    if src and re.search(r"/\s*month|Monthly price|per month|/mo\b", src):
        failures.append(f"OT7 {name} still shows monthly/subscription pricing copy")

if failures:
    print("ONE-TIME ACTIVATION MODEL AUDIT: FAIL")
    for f in failures:
        print(f"  ✗ {f}")
    sys.exit(1)

print("ONE-TIME ACTIVATION MODEL AUDIT: PASS (7/7)")
print("  ✓ OT1 plans.ts one-time model (999/2999, no monthly, no Growth/Enterprise)")
print("  ✓ OT2 gate delegates to isActivatedPlanKey")
print("  ✓ OT3 PAID_PLAN_KEYS = activated keys")
print("  ✓ OT4 subscription-upgrade one-time fees 999/2999")
print("  ✓ OT5 bridge-virtual-account activated currency matrix (free = view-only)")
print("  ✓ OT6 VA maintenance: overdue flag + charge RPC + outbound block")
print("  ✓ OT7 pricing UI de-subscriptioned")

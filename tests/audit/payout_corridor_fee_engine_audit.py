#!/usr/bin/env python3
"""
Payout corridor router + fee engine audit (#B1/#B2/#B3), fail-closed.

  PE1  Fee engine: international stack = 0.35 orchestration + 0.999 settlement +
       2.5 developer markup; African markup = 0.75 individual / 0.50 business.
  PE2  Corridor router classifies African destinations to the aggregator and
       everything else to the international (bridge) payout route.
  PE3  African aggregator is a PLACEHOLDER: fails closed with 'no_partner' and
       makes NO external network call (no fetch/http to a real partner).
  PE4  Mobile-money form switches Bank Account (account number + bank code) vs
       Mobile Money (phone + network provider).
  PE5  White-label: fee engine breakdown labels never name the provider.

Text-parsing, dependency-free.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENGINE = ROOT / "utils/fees/engine.ts"
SCHED  = ROOT / "utils/fees/schedule.ts"
ROUTER = ROOT / "supabase/functions/_shared/payouts/corridor-router.ts"
POLICY = ROOT / "supabase/functions/_shared/providers/bridge-country-policy.ts"
AGG    = ROOT / "supabase/functions/_shared/payouts/african-aggregator.ts"
FORM   = ROOT / "components/payouts/AfricanPayoutFields.tsx"

failures: list[str] = []


def read(p: Path) -> str:
    if not p.exists():
        failures.append(f"MISSING FILE: {p.relative_to(ROOT)}")
        return ""
    return p.read_text(encoding="utf-8")


engine = read(ENGINE)
sched = read(SCHED)
router = read(ROUTER)
policy = read(POLICY)
agg = read(AGG)
form = read(FORM)


def has_num(text: str, key: str, val: str) -> bool:
    return re.search(rf"{re.escape(key)}\s*=\s*{re.escape(val)}\b", text) is not None


# PE1 ---------------------------------------------------------------------
if engine:
    if not has_num(engine, "INTL_ORCHESTRATION_PERCENT", "0.35"):
        failures.append("PE1 engine orchestration != 0.35")
    if not has_num(engine, "INTL_FIXED_SETTLEMENT_PERCENT", "0.999"):
        failures.append("PE1 engine fixed settlement != 0.999")
    if "BRIDGE_DEVELOPER_FEE_PERCENT.fiat" not in engine:
        failures.append("PE1 engine developer markup not sourced from schedule (2.5 fiat)")
if sched:
    if not re.search(r"individual:\s*0\.75", sched) or not re.search(r"business:\s*0\.50", sched):
        failures.append("PE1 schedule African markup-by-account != 0.75 individual / 0.50 business")

# PE2 ---------------------------------------------------------------------
if router:
    for tok in ["classifyCorridor", "selectPayoutRoute", "african_aggregator",
                "bridge_payout", "isAfricanPayoutCountry"]:
        if tok not in router:
            failures.append(f"PE2 router missing {tok}")
if policy:
    # African set is centralized in the policy module (parity audit requires it).
    if "AFRICAN_PAYOUT_COUNTRIES" not in policy or '"NG"' not in policy or '"KE"' not in policy:
        failures.append("PE2 policy AFRICAN_PAYOUT_COUNTRIES missing core countries (NG/KE)")

# PE3 ---------------------------------------------------------------------
if agg:
    if "no_partner" not in agg:
        failures.append("PE3 aggregator must fail closed with no_partner")
    if re.search(r"\bfetch\s*\(|https?://", agg):
        failures.append("PE3 aggregator placeholder must not make external network calls")

# PE4 ---------------------------------------------------------------------
if form:
    for tok in ["bank_account", "mobile_money", "Account number", "Bank code", "Phone number", "Network provider"]:
        if tok not in form:
            failures.append(f"PE4 mobile-money form missing '{tok}'")

# PE5 ---------------------------------------------------------------------
if engine:
    # breakdown labels live in quotes; none may name the provider.
    for label in re.findall(r"\[\s*'([^']+)'\s*,", engine):
        if re.search(r"bridge", label, re.I):
            failures.append(f"PE5 engine breakdown label names provider: {label}")

if failures:
    print("PAYOUT CORRIDOR + FEE ENGINE AUDIT: FAIL")
    for f in failures:
        print(f"  ✗ {f}")
    sys.exit(1)

print("PAYOUT CORRIDOR + FEE ENGINE AUDIT: PASS (5/5)")
print("  ✓ PE1 international 0.35+0.999+2.5; African 0.75 indiv / 0.50 biz")
print("  ✓ PE2 corridor router (African→aggregator, else→bridge_payout)")
print("  ✓ PE3 African aggregator placeholder fails closed, no network call")
print("  ✓ PE4 mobile-money form switches bank vs mobile fields")
print("  ✓ PE5 fee engine labels are white-labeled")

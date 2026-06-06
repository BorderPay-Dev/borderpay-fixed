#!/usr/bin/env python3
"""
Payout corridor router + stablecoin fee engine audit (#B1/#B2/#B3), fail-closed.

African corridors now settle as EXTERNAL STABLECOIN withdrawals (USDT/USDC over
TRON/Polygon/Solana/Arbitrum/Base) — not a bank aggregator.

  PE1  Fee engine: international = 0.35 + 0.999 + 2.5; African (stablecoin) =
       0.10 Bridge USDT + 0.90 markup = 1.00% flat (both account types).
  PE2  Corridor router routes African → 'stablecoin' (NOT a bank aggregator).
  PE3  bridge-transfer no longer references the removed aggregator; African
       flows through the native Bridge stablecoin path.
  PE4  External crypto withdrawal form: network dropdown (TRON/Polygon/…) +
       destination address with per-network validation.
  PE5  Fee engine labels are white-labeled (no provider name); the African line
       is the single "BorderPay Network Fee".
  PE6  Checkout (SendMoneyFlow) uses the engine + classifyCorridor + discloses
       "BorderPay Network Fee".
  PE7  Frontend/backend African corridor sets are in parity.

Text-parsing, dependency-free.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENGINE = ROOT / "utils/fees/engine.ts"
ROUTER = ROOT / "supabase/functions/_shared/payouts/corridor-router.ts"
POLICY = ROOT / "supabase/functions/_shared/providers/bridge-country-policy.ts"
FE_CORRIDOR = ROOT / "utils/payouts/corridor.ts"
BTRANSFER = ROOT / "supabase/functions/bridge-transfer/index.ts"
SENDFLOW = ROOT / "components/send/SendMoneyFlow.tsx"
FORM = ROOT / "components/payouts/ExternalCryptoWithdrawalFields.tsx"

failures: list[str] = []


def read(p: Path) -> str:
    if not p.exists():
        failures.append(f"MISSING FILE: {p.relative_to(ROOT)}")
        return ""
    return p.read_text(encoding="utf-8")


engine = read(ENGINE)
router = read(ROUTER)
policy = read(POLICY)
fe_corridor = read(FE_CORRIDOR)
btransfer = read(BTRANSFER)
sendflow = read(SENDFLOW)
form = read(FORM)


def has(text: str, key: str, val: str) -> bool:
    return re.search(rf"{re.escape(key)}\s*=\s*{re.escape(val)}\b", text) is not None


# PE1 ---------------------------------------------------------------------
if engine:
    if not has(engine, "INTL_ORCHESTRATION_PERCENT", "0.35"):
        failures.append("PE1 intl orchestration != 0.35")
    if not has(engine, "INTL_FIXED_SETTLEMENT_PERCENT", "0.999"):
        failures.append("PE1 intl settlement != 0.999")
    if "BRIDGE_DEVELOPER_FEE_PERCENT.fiat" not in engine:
        failures.append("PE1 intl developer markup not sourced from schedule (2.5)")
    if not has(engine, "STABLECOIN_BRIDGE_USDT_PERCENT", "0.10"):
        failures.append("PE1 stablecoin Bridge USDT != 0.10")
    if not has(engine, "STABLECOIN_APP_MARKUP_PERCENT", "0.90"):
        failures.append("PE1 stablecoin app markup != 0.90")

# PE2 ---------------------------------------------------------------------
if router:
    for tok in ["classifyCorridor", "selectPayoutRoute", '"stablecoin"', '"bridge_payout"']:
        if tok not in router:
            failures.append(f"PE2 router missing {tok}")
    if "african_aggregator" in router:
        failures.append("PE2 router still references removed african_aggregator")

# PE3 ---------------------------------------------------------------------
if btransfer:
    if "executeAfricanPayout" in btransfer or "african-aggregator" in btransfer:
        failures.append("PE3 bridge-transfer still references the removed aggregator")

# PE4 ---------------------------------------------------------------------
if form:
    for tok in ["isValidCryptoAddress", "Destination address", "Network", "tron", "polygon", "solana", "arbitrum"]:
        if tok not in form:
            failures.append(f"PE4 crypto withdrawal form missing '{tok}'")

# PE5 ---------------------------------------------------------------------
if engine:
    if "BorderPay Network Fee" not in engine:
        failures.append("PE5 engine missing single 'BorderPay Network Fee' label")
    for label in re.findall(r"label:\s*'([^']+)'", engine) + re.findall(r"\[\s*'([^']+)'\s*,", engine):
        if re.search(r"bridge", label, re.I):
            failures.append(f"PE5 engine label names provider: {label}")

# PE6 ---------------------------------------------------------------------
if sendflow:
    for tok in ["computePayoutFee", "classifyCorridor", "BorderPay Network Fee"]:
        if tok not in sendflow:
            failures.append(f"PE6 SendMoneyFlow checkout missing {tok}")

# PE7 ---------------------------------------------------------------------
def african_codes(src: str) -> set:
    m = re.search(r"AFRICAN_PAYOUT_COUNTRIES[^\[]*\[(.*?)\]", src, re.S)
    return set(re.findall(r"[A-Z]{2}", m.group(1))) if m else set()

if fe_corridor and policy:
    fe_set, be_set = african_codes(fe_corridor), african_codes(policy)
    if not fe_set:
        failures.append("PE7 frontend corridor African set not found")
    elif fe_set != be_set:
        failures.append(f"PE7 frontend/backend African set drift: {fe_set ^ be_set}")

if failures:
    print("PAYOUT CORRIDOR + STABLECOIN FEE ENGINE AUDIT: FAIL")
    for f in failures:
        print(f"  ✗ {f}")
    sys.exit(1)

print("PAYOUT CORRIDOR + STABLECOIN FEE ENGINE AUDIT: PASS (7/7)")
print("  ✓ PE1 intl 0.35+0.999+2.5; African stablecoin 0.10+0.90 = 1.00%")
print("  ✓ PE2 corridor router African → stablecoin (no aggregator)")
print("  ✓ PE3 bridge-transfer free of the removed aggregator")
print("  ✓ PE4 external crypto withdrawal form (network + validated address)")
print("  ✓ PE5 engine white-labeled, single 'BorderPay Network Fee'")
print("  ✓ PE6 checkout uses engine + discloses 'BorderPay Network Fee'")
print("  ✓ PE7 frontend/backend African corridor sets in parity")

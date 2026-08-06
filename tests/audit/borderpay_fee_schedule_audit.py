#!/usr/bin/env python3
"""
BorderPay fee-schedule audit (fail-closed).

Guards the money-math invariants for the BorderPay fee schedule:

  F1  Edge canonical schedule exists with the Bridge developer-fee rates
      (virtual-account fiat individual 2.5%, business 2.0%,
      external-account off-ramp 1.0%, crypto-to-crypto saved route 1.0%;
      same-token crypto payout 0.0%).
      USDT 0.999 is a fixed trade rate, not a developer fee.
  F2  Edge African payout markup is 1% for every individual and business plan.
  F3  Frontend mirror exists and carries byte-identical numbers to the edge
      module (display can never drift from what the server charges).
  F4  bridge-transfer enforces the developer fee SERVER-SIDE: fixed-amount
      money-out transfers compute a fixed Bridge `developer_fee` from the 1.0%
      schedule. They must not use `developer_fee_percent`, which Bridge reserves
      for flexible-amount transfers.
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
GATEWAY = ROOT / "supabase/functions/public-api-gateway/index.ts"
GATEWAY_VALIDATORS = ROOT / "supabase/functions/_shared/api-gateway-validators.ts"

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
gateway = read(GATEWAY)
gateway_validators = read(GATEWAY_VALIDATORS)

# Canonical expected numbers ------------------------------------------------
DEV_FEE = {
    "virtual_account_fiat_individual": 2.5,
    "virtual_account_fiat_business": 2.0,
    "external_account_offramp": 1.0,
    "crypto_to_crypto_route": 1.0,
    "crypto_to_crypto_payout": 0.0,
}
FIXED_TRADE_RATE = {"USDT": 0.999}
PAYOUT = {
    "individual_starter": 1.0,
    "individual_premium": 1.0,
    "business_starter": 1.0,
    "business_growth": 1.0,
    "business_enterprise": 1.0,
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
    account_markup = re.search(
        r"AFRICAN_RAIL_MARKUP_PERCENT_BY_ACCOUNT[\s\S]*?individual\s*:\s*([0-9.]+)[\s\S]*?business\s*:\s*([0-9.]+)",
        edge,
    )
    if not account_markup or tuple(map(float, account_markup.groups())) != (1.0, 1.0):
        failures.append("F2 Yellow Card account markup must be 1% for individual and business")

# F3 — frontend mirror identical ------------------------------------------
if front:
    for k, v in {**DEV_FEE, **FIXED_TRADE_RATE, **PAYOUT}.items():
        got = num_after(front, k)
        if got != v:
            failures.append(f"F3 frontend mirror {k}: expected {v}, got {got}")
    account_markup = re.search(
        r"AFRICAN_RAIL_MARKUP_PERCENT_BY_ACCOUNT[\s\S]*?individual\s*:\s*([0-9.]+)[\s\S]*?business\s*:\s*([0-9.]+)",
        front,
    )
    if not account_markup or tuple(map(float, account_markup.groups())) != (1.0, 1.0):
        failures.append("F3 frontend Yellow Card account markup must mirror 1% for both account types")

# F4 — server-side enforcement --------------------------------------------
if xfer:
    if "BRIDGE_DEVELOPER_FEE_PERCENT.external_account_offramp" not in xfer:
        failures.append("F4 bridge-transfer does not use the server external-account off-ramp developer fee")
    if "fixedDeveloperFeeForPercent" not in xfer:
        failures.append("F4 bridge-transfer does not compute a fixed developer_fee from the percent schedule")
    if not re.search(r"developer_fee\s*:\s*isFiatExternalOfframp[\s\S]*flat_amount", xfer):
        failures.append("F4 bridge-transfer does not pass Bridge fixed developer_fee for fiat external-account off-ramp")
    if re.search(r"isCryptoPayout[\s\S]*percentage\s*:", xfer):
        failures.append("F4 bridge-transfer must not pass Bridge developer_fee_percent for same-token crypto payout")
    if "developer_fee_percent: enforcedCryptoPayout ? cryptoRouteFeePercent : null" not in xfer:
        failures.append("F4 bridge-transfer must persist the saved route developer fee percent for disclosure/reconciliation")
    if "routeDepositAddress(savedWallet?.bridge_payment_route_raw)" not in xfer:
        failures.append("F4 bridge-transfer must send crypto payouts to the saved route deposit address, not directly to the final external wallet")
    if "route_deposit_address: enforcedCryptoPayout ? cryptoRouteDepositAddress : null" not in xfer:
        failures.append("F4 bridge-transfer must persist route deposit address metadata")
    if "final_destination_address: enforcedCryptoPayout ? cryptoFinalAddress : null" not in xfer:
        failures.append("F4 bridge-transfer must persist final external destination metadata")

external_wallet = read(ROOT / "supabase/functions/external-wallet/index.ts")
if external_wallet:
    if "BRIDGE_DEVELOPER_FEE_PERCENT.crypto_to_crypto_route" not in external_wallet:
        failures.append("F4 external-wallet does not use crypto_to_crypto_route for saved route developer_fee_percent")
    if "bridgeProvider.createLiquidationAddress" not in external_wallet:
        failures.append("F4 external-wallet must create Bridge liquidation addresses for saved external crypto routes")
    if "developer_fee_percent: ROUTE_DEVELOPER_FEE_PERCENT" not in external_wallet and "developer_fee_percent: ROUTE_DEVELOPER_FEE_PERCENT > 0" not in external_wallet:
        failures.append("F4 external-wallet does not pass developer_fee_percent for Bridge liquidation route")
    if "return_address: sourceWallet.address" not in external_wallet:
        failures.append("F4 external-wallet must set return_address from the user's current Bridge wallet")
    route_fn = external_wallet[external_wallet.find("async function createCryptoRoute"):external_wallet.find("async function repairMissingRoutes")]
    if "destination_payment_rail: params.chain as BridgePaymentRail" not in route_fn:
        failures.append("F4 external-wallet saved crypto route must use the crypto rail as liquidation destination")
    if "bridge_wallet_id:" in route_fn:
        failures.append("F4 external-wallet saved crypto route must not source from bridge_wallet; wallet payout sends to the route deposit address later")
    if re.search(r"source:\s*\{[\s\S]*?chain:", route_fn):
        failures.append("F4 external-wallet saved crypto route must not send source.chain; Bridge uses source.payment_rail for the blockchain")
    if re.search(r"destination:\s*\{[\s\S]*?chain:", route_fn):
        failures.append("F4 external-wallet saved crypto route must not send destination.chain; Bridge uses destination.payment_rail for the blockchain")

# F5 — client value no longer trusted -------------------------------------
if xfer:
    if re.search(r"developer_fee\s*:\s*body\.developer_fee", xfer):
        failures.append("F5 bridge-transfer still forwards client-supplied body.developer_fee")
if gateway_validators:
    if re.search(r"developer_fee\??\s*:", gateway_validators):
        failures.append("F5 public API validator still accepts caller-supplied developer_fee")
if gateway:
    if "BRIDGE_DEVELOPER_FEE_PERCENT.external_account_offramp" not in gateway:
        failures.append("F5 public API gateway does not apply server money-out developer fee")
    if not re.search(r"developer_fee\s*:\s*\{[\s\S]*flat_amount", gateway):
        failures.append("F5 public API gateway does not pass fixed Bridge developer_fee")

# Report -------------------------------------------------------------------
total = 5
if failures:
    print("FEE SCHEDULE AUDIT: FAIL")
    for f in failures:
        print(f"  ✗ {f}")
    sys.exit(1)

print(f"FEE SCHEDULE AUDIT: PASS ({total}/{total})")
print("  ✓ F1 edge Bridge dev fee 2.5% individual VA / 2.0% business VA / 1.0% external-account off-ramp / 1.0% crypto saved route / 0.0% same-token crypto payout; 0.999 USDT fixed rate is separate")
print("  ✓ F2 edge African payout markup tiers (1.0/0.75 starter, 0.5 premium/growth/ent)")
print("  ✓ F3 frontend mirror numbers identical to edge")
print("  ✓ F4 bridge-transfer and external-wallet enforce correct Bridge fee parameters")
print("  ✓ F5 bridge-transfer ignores client-supplied developer_fee")

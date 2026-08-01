#!/usr/bin/env python3
"""
Crypto-to-crypto saved route fee audit.

Guards the Bridge liquidation-address route path used by saved external
USDC/Base and USDT/Tron withdrawal wallets.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEDULE = ROOT / "supabase/functions/_shared/fees/schedule.ts"
EXTERNAL_WALLET = ROOT / "supabase/functions/external-wallet/index.ts"
SEND_FLOW = ROOT / "components/send/SendMoneyFlow.tsx"

failures: list[str] = []


def read(path: Path) -> str:
    if not path.exists():
        failures.append(f"missing file: {path.relative_to(ROOT)}")
        return ""
    return path.read_text(encoding="utf-8")


schedule = read(SCHEDULE)
external_wallet = read(EXTERNAL_WALLET)
send_flow = read(SEND_FLOW)

if not re.search(r"crypto_to_crypto_route\s*:\s*1\.0", schedule):
    failures.append("server fee schedule must keep crypto_to_crypto_route at 1.0")

if external_wallet:
    required_tokens = [
        "BRIDGE_DEVELOPER_FEE_PERCENT.crypto_to_crypto_route",
        "ROUTE_DEVELOPER_FEE_PERCENT_STRING",
        "bridgeProvider.createLiquidationAddress",
        "developer_fee_percent: ROUTE_DEVELOPER_FEE_PERCENT > 0 ? String(ROUTE_DEVELOPER_FEE_PERCENT) : undefined",
        "routeRawWithFeeMetadata(route.raw)",
        "borderpay_route_fee_percent",
        "server_fee_schedule",
    ]
    for token in required_tokens:
        if token not in external_wallet:
            failures.append(f"external-wallet route fee guard missing token: {token}")

if send_flow:
    if "raw?.developer_fee_percent" not in send_flow:
        failures.append("send flow must read top-level route developer_fee_percent")
    if "routeDeveloperFeePercent" not in send_flow:
        failures.append("send flow must use saved route developer fee for preview disclosure")

if failures:
    print("CRYPTO ROUTE FEE AUDIT: FAIL")
    for failure in failures:
        print(f"  ✗ {failure}")
    sys.exit(1)

print("CRYPTO ROUTE FEE AUDIT: PASS")
print("  ✓ crypto-to-crypto saved routes persist 1.0% fee metadata for UI and transfer disclosure")

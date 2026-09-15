#!/usr/bin/env python3
"""Regression gate for direct crypto-to-crypto external-wallet transfers."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXTERNAL_WALLET = ROOT / "supabase/functions/external-wallet/index.ts"
BRIDGE_TRANSFER = ROOT / "supabase/functions/bridge-transfer/index.ts"
BRIDGE_PROVIDER = ROOT / "supabase/functions/_shared/providers/bridge.ts"
SEND_FLOW = ROOT / "components/send/SendMoneyFlow.tsx"

failures: list[str] = []


def read(path: Path) -> str:
    if not path.exists():
        failures.append(f"missing file: {path.relative_to(ROOT)}")
        return ""
    return path.read_text(encoding="utf-8")


external_wallet = read(EXTERNAL_WALLET)
bridge_transfer = read(BRIDGE_TRANSFER)
bridge_provider = read(BRIDGE_PROVIDER)
send_flow = read(SEND_FLOW)

for token in [
    "bridgeProvider.createLiquidationAddress",
    "createCryptoRoute",
    "bridgeProvider.getLiquidationAddress",
    "bridgeProvider.updateLiquidationAddressDeveloperFee",
]:
    if token in external_wallet:
        failures.append(f"external-wallet retained liquidation API dependency: {token}")

for token in [
    'source_payment_rail: "bridge_wallet"',
    'destination_payment_rail: "base" | "tron"',
    '.select("id, address, asset, chain")',
    "address: cryptoFinalAddress",
    "to_address: cryptoFinalAddress",
    'transfer_method: enforcedCryptoPayout ? "crypto_to_crypto_transfer" : null',
    "final_destination_address: enforcedCryptoPayout ? cryptoFinalAddress : null",
]:
    if token not in bridge_transfer:
        failures.append(f"direct transfer contract missing: {token}")

for token in [
    "routeDepositAddress",
    "cryptoRouteDepositAddress",
    'code: "external_wallet_route_required"',
    'code: "external_wallet_route_mismatch"',
]:
    if token in bridge_transfer:
        failures.append(f"bridge-transfer retained liquidation dependency: {token}")

provider_transfer = bridge_provider[
    bridge_provider.find("async createTransfer"):
    bridge_provider.find("const r = await bridgeFetch", bridge_provider.find("async createTransfer"))
]
if 'method: "POST", path: "/v0/transfers"' not in bridge_provider:
    failures.append("provider /v0/transfers endpoint missing")
if "to_address: input.destination.address" not in provider_transfer:
    failures.append("provider must serialize the direct destination address as to_address")
if "createLiquidationAddress" in provider_transfer:
    failures.append("provider transfer path must not call liquidation address APIs")
if "initiation:" not in provider_transfer or "attestations: { sca:" not in provider_transfer:
    failures.append("provider transfer must preserve the conditional EEA SCA initiation attestation")

stablecoin_send = send_flow[
    send_flow.find("result = await backendAPI.stablecoin.sendTransfer"):
    send_flow.find("} else if (method === 'us_ach_wire')")
]
if "bridge_payment_route_id: cryptoSavedRouteId" in stablecoin_send:
    failures.append("current client must not send a liquidation route id")
if "external_wallet_id: cryptoSavedWalletId" not in stablecoin_send:
    failures.append("current client must bind the transfer to a saved external wallet")

if failures:
    print("CRYPTO DIRECT TRANSFER AUDIT: FAIL")
    for failure in failures:
        print(f"  ✗ {failure}")
    sys.exit(1)

print("CRYPTO DIRECT TRANSFER AUDIT: PASS")
print("  ✓ saved destinations use /v0/transfers directly; liquidation routes remain historical only")

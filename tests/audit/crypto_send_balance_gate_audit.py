#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
send_flow = ROOT / "components/send/SendMoneyFlow.tsx"
src = send_flow.read_text()

needle = "if (method === 'stablecoin')"
idx = src.find(needle)
assert idx != -1, "stablecoin canProceedAmount branch missing"
branch = src[idx:src.find("if (isAfricanPayout)", idx)]

failures = []
if "num <= selectedWallet.balance" in branch or "selectedWallet && num <=" in branch:
    failures.append("Stablecoin send must not hard-block on local wallet balance cache.")
if "isValidCryptoAddress(crypto.network, crypto.address)" not in branch:
    failures.append("Stablecoin send must still require a valid external wallet address.")
if "reason.trim().length > 0" not in branch:
    failures.append("Stablecoin send must still require a user reason.")
if "stablecoinMinimumError" not in src:
    failures.append("Stablecoin send must keep minimum/dust validation.")
if "cryptoRouteDetailsReady" not in src or "Refresh this saved withdrawal wallet before sending" not in src:
    failures.append("Stablecoin send must fail closed until saved route raw/deposit details are loaded.")
if "borderpay_external_wallets_v2" not in src:
    failures.append("Stablecoin send must use a bumped external-wallet cache key after adding route raw requirements.")
if "bridge_wallet_id: selectedWallet.bridge_wallet_id" not in src:
    failures.append("Stablecoin send must pass the selected Bridge wallet id to the backend.")
if "!!cryptoSavedRouteId" not in src or "bridge_payment_route_id: cryptoSavedRouteId" not in src:
    failures.append("Stablecoin send must require and pass the saved BorderPay route id.")
if "!!cryptoSavedWalletId" not in src or "external_wallet_id: cryptoSavedWalletId" not in src:
    failures.append("Stablecoin send must require and pass the saved external wallet id.")
if "This wallet is not ready for sending yet" not in src:
    failures.append("Stablecoin send must fail cleanly if the selected wallet has no Bridge wallet id.")

api_src = (ROOT / "utils/api/backendAPI.ts").read_text()
if "bridge_wallet_id?: string | null" not in api_src:
    failures.append("stablecoinAPI.sendTransfer must accept a Bridge wallet id.")
if "external_wallet_id?: string | null" not in api_src or "bridge_payment_route_id?: string | null" not in api_src:
    failures.append("stablecoinAPI.sendTransfer must accept saved wallet and route identifiers.")
if "...(data.bridge_wallet_id ? { bridge_wallet_id: data.bridge_wallet_id } : {})" not in api_src:
    failures.append("stablecoinAPI.sendTransfer must forward source.bridge_wallet_id.")
if "...(data.external_wallet_id ? { external_wallet_id: data.external_wallet_id } : {})" not in api_src:
    failures.append("stablecoinAPI.sendTransfer must forward destination.external_wallet_id.")
if "...(data.bridge_payment_route_id ? { bridge_payment_route_id: data.bridge_payment_route_id } : {})" not in api_src:
    failures.append("stablecoinAPI.sendTransfer must forward destination.bridge_payment_route_id.")
if "payment_rail: 'bridge_wallet'" not in api_src:
    failures.append("Crypto payout source must use Bridge source.payment_rail='bridge_wallet'.")
if "payment_rail: data.chain" not in api_src:
    failures.append("Crypto payout destination must use the chain rail (base/tron), not an invented rail.")
if "payment_rail: 'stablecoin'" in api_src[api_src.find("async sendTransfer"):api_src.find("export const adminAPI", api_src.find("async sendTransfer"))]:
    failures.append("Crypto payout request must not send payment_rail='stablecoin' to Bridge.")
if "getSendRouteData" in api_src and "financialReadModelAPI.getSnapshot(20)" not in api_src[api_src.find("async getSendRouteData"):api_src.find("export const addressAPI")]:
    failures.append("Send route data must hydrate from the shared financial snapshot cache before slower wallet reads.")

edge_src = (ROOT / "supabase/functions/bridge-transfer/index.ts").read_text()
if 'code: "source_wallet_required"' not in edge_src:
    failures.append("bridge-transfer must reject crypto payouts without source.bridge_wallet_id before calling Bridge.")
if 'code: "external_wallet_route_required"' not in edge_src:
    failures.append("bridge-transfer must reject crypto payouts when the saved wallet has no BorderPay route id.")
if 'code: "external_wallet_route_mismatch"' not in edge_src:
    failures.append("bridge-transfer must reject crypto payouts when the client route id does not match the saved wallet.")
if "routeDepositAddress(savedWallet?.bridge_payment_route_raw)" not in edge_src:
    failures.append("bridge-transfer must extract the Bridge payment-route deposit address from the saved external wallet route.")
if "obj.address" not in edge_src:
    failures.append("bridge-transfer route deposit extraction must support liquidation-address raw.address.")
if "address: cryptoRouteDepositAddress" not in edge_src or "final_address: cryptoFinalAddress" not in edge_src:
    failures.append("bridge-transfer must rewrite crypto payout destination to the route deposit address while preserving final external address metadata.")
success_response_start = edge_src.find("return json({", edge_src.find("success: true"))
success_response = edge_src[success_response_start:edge_src.find("});", success_response_start)]
if "route_deposit_address" in success_response or "cryptoRouteDepositAddress" in success_response:
    failures.append("bridge-transfer success response must not expose the backend liquidation deposit address to the UI.")
if 'body.source.payment_rail || "stablecoin"' in edge_src:
    failures.append("bridge-transfer must not default missing source payment rail to stablecoin.")
if 'source_payment_rail: "bridge_wallet"' not in edge_src:
    failures.append("bridge-transfer crypto payout type must enforce Bridge wallet source rail.")
if "customer_id:  profile.bridge_customer_id" in edge_src:
    failures.append("bridge-transfer must not send source.customer_id to Bridge transfer body; use on_behalf_of + bridge_wallet_id.")
create_transfer_start = edge_src.find("bridgeProvider.createTransfer")
crypto_dev_fee_slice = edge_src[
    edge_src.find("developer_fee:", create_transfer_start):
    edge_src.find("// Pass the same canonical key", create_transfer_start)
]
if "isCryptoPayout" in crypto_dev_fee_slice:
    failures.append("bridge-transfer must not pass developer_fee to Bridge for same-token crypto payouts; Bridge rejects USDC->USDC/USDT->USDT developer_fee.")

validator_src = (ROOT / "supabase/functions/_shared/bridge-payout-validator.ts").read_text()
if 'srcRail === "bridge_wallet"' not in validator_src:
    failures.append("Bridge payout validator must require source.payment_rail=bridge_wallet.")
if 'dstRail === "base" || dstRail === "tron"' not in validator_src:
    failures.append("Bridge payout validator must require destination.payment_rail base/tron.")
if 'payment_rail: "stablecoin"' in validator_src:
    failures.append("Bridge payout validator fixtures must not use payment_rail=stablecoin.")

gateway_validator_src = (ROOT / "supabase/functions/_shared/api-gateway-validators.ts").read_text()
if '"stablecoin",' in gateway_validator_src or '"stablecoin"' in gateway_validator_src[gateway_validator_src.find("const SOURCE_RAILS"):gateway_validator_src.find("function invalid")]:
    failures.append("Public API transfer validator must not accept stablecoin as a payment rail.")
if '"base"' not in gateway_validator_src or '"tron"' not in gateway_validator_src:
    failures.append("Public API transfer validator must allow Bridge chain rails base/tron.")
if "source.bridge_wallet_id required for bridge_wallet source" not in gateway_validator_src:
    failures.append("Public API transfer validator must require bridge_wallet_id for bridge_wallet source.")

provider_types_src = (ROOT / "supabase/functions/_shared/providers/types.ts").read_text()
rail_start = provider_types_src.find("export type BridgePaymentRail")
rail_end = provider_types_src.find(";", rail_start)
rail_union = provider_types_src[rail_start:rail_end]
if '| "stablecoin"' in rail_union:
    failures.append("BridgePaymentRail must not include stablecoin as a live transfer rail.")

provider_src = (ROOT / "supabase/functions/_shared/providers/bridge.ts").read_text()
provider_transfer = provider_src[provider_src.find("async createTransfer"):provider_src.find("const r = await bridgeFetch", provider_src.find("async createTransfer"))]
if "customer_id:" in provider_transfer:
    failures.append("Bridge provider must not serialize source.customer_id for transfers.")
if '"stablecoin"' in provider_transfer:
    failures.append("Bridge provider transfer body must not map or serialize payment_rail=stablecoin.")

for relative in [
    "supabase/functions/affiliate-withdraw/index.ts",
    "supabase/functions/business-bulk-pay/index.ts",
    "supabase/functions/bridge-bulk-payout/index.ts",
]:
    path = ROOT / relative
    if not path.is_file():
        # Retired optional callers are outside the active Bridge runtime. If a
        # caller returns later, this audit automatically inspects it again.
        continue
    body = path.read_text()
    if 'payment_rail: "stablecoin"' in body or '|| "stablecoin"' in body:
        failures.append(f"{relative} must not use payment_rail=stablecoin in Bridge transfers.")

external_wallet_src = (ROOT / "supabase/functions/external-wallet/index.ts").read_text()
add_start = external_wallet_src.find('if (action === "add")')
add_slice = external_wallet_src[add_start:external_wallet_src.find('return json({ success: false, error: "Unknown action" }', add_start)]
existing_idx = add_slice.find("existingWallet?.bridge_payment_route_id")
create_idx = add_slice.find("createCryptoRoute")
if existing_idx == -1 or create_idx == -1 or existing_idx > create_idx:
    failures.append("external-wallet add must reuse an existing saved route before creating a new Bridge route.")
if "reused_route: true" not in add_slice:
    failures.append("external-wallet add must return reused_route when it avoids duplicate Bridge route creation.")

if failures:
    print("crypto_send_balance_gate_audit: FAIL")
    for failure in failures:
        print(f"- {failure}")
    raise SystemExit(1)

print("crypto_send_balance_gate_audit: PASS")

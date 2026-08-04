from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TX = (ROOT / "supabase/functions/yellowcard-sandbox-transaction/index.ts").read_text()
CAPS = (ROOT / "supabase/functions/yellowcard-capabilities/index.ts").read_text()
SYNC = (ROOT / "supabase/functions/yellowcard-corridor-sync/index.ts").read_text()
PAYLOAD = (ROOT / "supabase/functions/_shared/providers/yellowcard-payload.ts").read_text()
RECEIVE_UI = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()
FEE_MIGRATION = (ROOT / "supabase/migrations/20260804134000_yellowcard_customer_fee_contract.sql").read_text()

required_tx = [
    "authenticateAfricanRailsTester",
    'config.environment !== "sandbox"',
    'flag("YC_LIVE_ROUTING_ENABLED")',
    'flag("YC_MONEY_MOVEMENT_ENABLED")',
    'provider: "yellow_card"',
    'direction: "receive"',
    'path: "/receive"',
    "operator_confirmation_required",
    "yellow_card_reconciliation_required",
    "redactYellowCardReceivePayload",
]
required_payload = [
    'cryptoCurrency: "USDC"',
    'cryptoNetwork: "BASE"',
    'cryptoCurrency: "USDT"',
    'cryptoNetwork: "TRC20"',
    'required(input.recipient.idNumber, "recipient_id_number")',
]

failures = []
for token in required_tx:
    if token not in TX:
        failures.append(f"transaction adapter missing: {token}")
for token in required_payload:
    if token not in PAYLOAD:
        failures.append(f"payload guard missing: {token}")
if "yellow_card_commercial_map_required" not in SYNC:
    failures.append("corridor sync can bypass the internal commercial map")
if '.from("provider_corridor_policy").insert' in SYNC or '.from("provider_corridor_policy")\n      .insert' in SYNC:
    failures.append("corridor sync still writes provider-discovered routes")
for token in ["authenticateAfricanRailsTester", 'provider: "yellow_card"', 'direction !== "receive"']:
    if token not in CAPS:
        failures.append(f"Yellow Card capabilities missing: {token}")
for token in [
    "yellowCardSandboxTransaction",
    "action: 'preflight'",
    "action: 'create_receive'",
    "operator_confirmed: true",
    "settlement_currency",
    "settlement_network",
    "selectedYellowCardChannelId",
    "selectedYellowCardNetworkId",
]:
    if token not in RECEIVE_UI:
        failures.append(f"Yellow Card receive UI missing: {token}")
if "backendAPI.payouts.createCollection" in RECEIVE_UI:
    failures.append("Yellow Card receive UI still calls the retired collection endpoint")
if "collectionSourceAccount" in RECEIVE_UI or "Payer mobile money number" in RECEIVE_UI:
    failures.append("Yellow Card sandbox UI still collects payer data ignored by the provider payload")
if "provider_cost:" in TX:
    failures.append("Yellow Card preflight exposes internal provider cost to the app")
if "provider_fee_percent" in RECEIVE_UI or "provider_fee_local" in RECEIVE_UI or "provider_fee_usd" in RECEIVE_UI:
    failures.append("Yellow Card UI incorrectly maps internal provider cost to the transaction fee")
for token in [
    "customer_fee_percent",
    "when channel = 'mobile_money' then 2.50",
    "when channel = 'bank' then 2.75",
]:
    if token not in FEE_MIGRATION:
        failures.append(f"Yellow Card customer fee contract missing: {token}")

if failures:
    print("yellowcard_sandbox_gate_audit: FAIL")
    for failure in failures:
        print(f" - {failure}")
    raise SystemExit(1)

print("yellowcard_sandbox_gate_audit: PASS")

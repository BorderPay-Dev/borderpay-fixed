#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
edge = (ROOT / "supabase/functions/yellowcard-transaction/index.ts").read_text()
jit_edge = (ROOT / "supabase/functions/yellowcard-jit-payout/index.ts").read_text()
ui = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
receive_ui = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()
capabilities = (ROOT / "supabase/functions/yellowcard-capabilities/index.ts").read_text()
commercial_policy = (ROOT / "supabase/functions/_shared/providers/yellowcard-commercial-policy.ts").read_text()
routing = (ROOT / "supabase/functions/_shared/providers/yellowcard-routing.ts").read_text()
server_fees = (ROOT / "supabase/functions/_shared/fees/schedule.ts").read_text()
client_fees = (ROOT / "utils/fees/schedule.ts").read_text()

for fragment in (
    'action === "preflight_send" || action === "create_send"',
    'buildYellowCardSendPayload({',
    'redactYellowCardSendPayload(providerBody)',
    '!flag("YC_PRODUCTION_SEND_ENABLED")',
    'code: "yellow_card_payout_locked"',
    'path: isSend ? "/send" : "/receive"',
    'direction: isSend ? "payout" : "receive"',
    'const networkRequired = isSend || context.channel === "mobile_money"',
):
    assert fragment in edge, f"missing Yellow Card production boundary: {fragment}"

send_lock = 'if (isSend && !flag("YC_PRODUCTION_SEND_ENABLED"))'
assert edge.index(send_lock) < edge.rindex('const sequenceId = str(body?.sequence_id)')
assert 'allow_all_receive_countries' not in edge

payload_builder = (ROOT / "supabase/functions/_shared/providers/yellowcard-payload.ts").read_text()
assert "buildYellowCardReceivePayload" in payload_builder
assert "buildYellowCardSendPayload" in payload_builder
assert "redactYellowCardSendPayload" in payload_builder
assert "directSettlement: true" in payload_builder

for fragment in (
    "loadYellowCardCapability('quote'",
    "loadYellowCardCapability('routing'",
    "yellowCardJitPayout({ action: 'readiness' })",
    "result?.data?.execution_enabled === true",
    "convertYellowCardLocalFeeToFunding(africanPolicyFee.amount, destinationAmount, sourceAmount)",
    "const executionLocalAmount = Math.round(africanQuote.destinationAmount)",
    "result.data?.payout?.id",
    "result.data?.payout?.sequence_id",
):
    assert fragment in ui, f"missing Yellow Card send UI contract: {fragment}"

# Both the PIN and EEA-SCA continuation paths retain the same idempotent JIT
# request, while the endpoint remains the final rollout authority.
assert ui.count("action: 'create'") == 2
assert "if (!africanPayoutEnabled)" in ui
assert ui.count("account_number:") >= 2
assert "yellowCardJitPayout" in ui
assert 'code: "yellow_card_jit_payout_disabled"' in jit_edge

assert "backendAPI.payouts.createTransfer" not in ui
assert "backendAPI.payouts.resolveAccount" not in ui
assert "['phone', 'momo', 'mobile', 'mobile_money', 'mobilemoney', 'msisdn'].includes(accountType)" in ui
assert 'rates: { path: "/rates"' in capabilities
assert 'if (["bank", "eft", "p2p"].includes(normalized)) return "bank"' in routing
assert 'const selectedChannel = requestedNetworkId' in routing
assert 'amountChannels.find((channel) => linkedIds.has(text(channel?.id)))' in routing

for fragment in (
    "loadYellowCardCapability('routing'",
    "selectedCollectionNetworkId",
    "network_id: selectedCollectionNetworkId || undefined",
    "selectedAfricanRail?.channel === 'mobile_money' && !selectedCollectionNetworkId",
    "calculateYellowCardCustomerFee(selectedAfricanPolicyRow",
):
    assert fragment in receive_ui, f"missing Yellow Card receive UI contract: {fragment}"

assert "calculateYellowCardCustomerFee(context.policy, context.localAmount)" in edge
assert "total_amount_local: customerFee.customer_amount_local" in edge
assert 'SOURCE_DOCUMENT = "Yellow Card Treasury Portal Order Form - Standard Pricing, Addendum 1"' in commercial_policy
assert 'SOURCE_DOCUMENT_DATE = "2026-07-08"' in commercial_policy
assert 'AFRICAN_RAIL_MARKUP_DEFAULT_PERCENT = 2.0' in server_fees
assert 'AFRICAN_RAIL_MARKUP_DEFAULT_PERCENT = 2.0' in client_fees
assert 'if (isAfricanPayout) return null' in ui
assert 'percent: fee.customerPercent' in ui
assert 'percent: fee.customerPercent' in receive_ui
assert 'percent: fee.effectivePercent' not in ui
assert 'percent: fee.effectivePercent' not in receive_ui
print("yellowcard send execution audit passed")

#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
edge = (ROOT / "supabase/functions/yellowcard-sandbox-transaction/index.ts").read_text()
ui = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
receive_ui = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()
capabilities = (ROOT / "supabase/functions/yellowcard-capabilities/index.ts").read_text()
commercial_policy = (ROOT / "supabase/functions/_shared/providers/yellowcard-commercial-policy.ts").read_text()
routing = (ROOT / "supabase/functions/_shared/providers/yellowcard-routing.ts").read_text()
server_fees = (ROOT / "supabase/functions/_shared/fees/schedule.ts").read_text()
client_fees = (ROOT / "utils/fees/schedule.ts").read_text()

for fragment in (
    'action === "preflight_send"',
    'action === "create_send"',
    'path: isSend ? "/send" : "/receive"',
    'sandboxOutcome',
    '"1111111111" : "0000000000"',
    'name: `${sandboxOutcome === "success" ? "Successful" : "Failure"} ${context.kyc.name}`',
    'accountNumber: sandboxAccount(context.country, context.channel, sandboxOutcome)',
    'cryptoAmount: Number(body?.crypto_amount)',
    'SANDBOX_FAILURE_EVM_ADDRESS',
    'SANDBOX_FAILURE_TRON_ADDRESS',
    'accountNumber: sandboxAccount(context.country, context.channel, "success")',
    'direction: isSend ? "payout" : "receive"',
    'existing.direction === "payout"',
    'buildYellowCardSandboxSendPayload({',
    'channelId: str(context.selectedChannel?.id)',
    'localAmount: context.localAmount',
    'const networkRequired = isSend || context.channel === "mobile_money"',
):
    assert fragment in edge, f"missing Yellow Card send server contract: {fragment}"

payload_builder = (ROOT / "supabase/functions/_shared/providers/yellowcard-payload.ts").read_text()
send_payload = payload_builder.split("export function buildYellowCardSandboxReceivePayload", 1)[0]
assert "directSettlement: true" in send_payload
assert "localAmount," not in send_payload

for fragment in (
    "loadYellowCardCapability('quote'",
    "loadYellowCardCapability('routing'",
    "action: 'preflight_send'",
    "action: 'create_send'",
    "yellowCardSandboxOutcome",
    "convertYellowCardLocalFeeToFunding(africanPolicyFee.amount, destinationAmount, sourceAmount)",
    "const executionLocalAmount = Math.round(africanQuote.destinationAmount)",
    "result.data?.transaction?.provider_transaction_id",
    "result.data?.transaction?.sequence_id",
):
    assert fragment in ui, f"missing Yellow Card send UI contract: {fragment}"

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
    "const networkRequired = selectedAfricanRail.channel === 'mobile_money'",
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

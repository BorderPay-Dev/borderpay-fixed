#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
edge = (ROOT / "supabase/functions/yellowcard-sandbox-transaction/index.ts").read_text()
ui = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
receive_ui = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()
capabilities = (ROOT / "supabase/functions/yellowcard-capabilities/index.ts").read_text()
commercial_policy = (ROOT / "supabase/functions/_shared/providers/yellowcard-commercial-policy.ts").read_text()

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
    '"withdraw", "withdrawal"',
    'new Set(["phone", "momo", "mobile_money", "mobilemoney"])',
):
    assert fragment in edge, f"missing Yellow Card send server contract: {fragment}"

for fragment in (
    "yellowCardCapabilities('rates'",
    "yellowCardCapabilities('networks'",
    "action: 'preflight_send'",
    "action: 'create_send'",
    "yellowCardSandboxOutcome",
    "result.data?.transaction?.provider_transaction_id",
    "result.data?.transaction?.sequence_id",
):
    assert fragment in ui, f"missing Yellow Card send UI contract: {fragment}"

assert "backendAPI.payouts.createTransfer" not in ui
assert "backendAPI.payouts.resolveAccount" not in ui
assert "['phone', 'momo', 'mobile_money', 'mobilemoney'].includes(accountType)" in ui
assert 'rates: { path: "/rates"' in capabilities

for fragment in (
    "yellowCardCapabilities('networks'",
    "selectedCollectionNetworkId",
    "network_id: selectedCollectionNetworkId || undefined",
    "if (!selectedChannelId || !selectedNetworkId)",
    "africanRailMarkupPercentForAccount(accountType)",
):
    assert fragment in receive_ui, f"missing Yellow Card receive UI contract: {fragment}"

assert "africanRailMarkupPercentForAccount(context.profile?.account_type)" in edge
assert "total_amount_local: providerFeeAmount + markupFeeAmount" in edge
assert 'SOURCE_DOCUMENT = "Yellow Card Treasury Portal Order Form - Standard Pricing, Addendum 1"' in commercial_policy
assert 'SOURCE_DOCUMENT_DATE = "2026-07-08"' in commercial_policy
print("yellowcard send execution audit passed")

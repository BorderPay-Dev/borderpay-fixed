#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
edge = (ROOT / "supabase/functions/yellowcard-sandbox-transaction/index.ts").read_text()
ui = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
capabilities = (ROOT / "supabase/functions/yellowcard-capabilities/index.ts").read_text()

for fragment in (
    'action === "preflight_send"',
    'action === "create_send"',
    'path: isSend ? "/send" : "/receive"',
    'sandboxOutcome',
    '"1111111111" : "0000000000"',
    'name: `${sandboxOutcome === "success" ? "Successful" : "Failure"} ${context.kyc.name}`',
    'accountNumber: sandboxAccount(context.country, context.channel, sandboxOutcome)',
    'cryptoAmount: Number(body?.crypto_amount)',
    'direction: isSend ? "payout" : "receive"',
    'existing.direction === "payout"',
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
assert 'rates: { path: "/rates"' in capabilities
print("yellowcard send execution audit passed")

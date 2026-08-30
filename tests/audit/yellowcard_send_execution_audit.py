#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ui = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
api = (ROOT / "utils/api/backendAPI.ts").read_text()
jit = (ROOT / "supabase/functions/yellowcard-jit-payout/index.ts").read_text()
worker = (ROOT / "supabase/functions/yellowcard-jit-worker/index.ts").read_text()
relay = (ROOT / "infrastructure/yellowcard-relay/server.mjs").read_text()

for fragment in (
    "AFRICAN_SEND_EXECUTION_ENABLED = true",
    "buildYellowCardJitRequest",
    "yellowCardJitPayout",
    "idempotency_key: transferIdempotencyKey",
    "reason: reason.trim()",
    "resource: 'yellowcard_jit_payout'",
):
    assert fragment in ui, f"missing production Send UI contract: {fragment}"

assert "yellowCardJitPayout" in api
assert "yellowCardSandboxTransaction" not in api
assert "yellowCardSandboxTransaction" not in ui

for fragment in (
    'flag("YC_PRODUCTION_SEND_ENABLED")',
    'flag("YC_JIT_PAYOUT_ENABLED")',
    'eq("idempotency_key", idempotencyKey)',
    'consumeScaAuthorization',
    'reserve_yellowcard_jit_payout',
):
    assert fragment in jit, f"missing JIT endpoint contract: {fragment}"

for fragment in (
    'path: "/send"',
    '`/send/sequence-id/${encodeURIComponent(row.sequence_id)}`',
    'buildYellowCardJitFundingTransfer',
    'claim_yellowcard_jit_payouts',
):
    assert fragment in worker, f"missing JIT worker contract: {fragment}"

assert 'path === "/send"' in relay
assert '/(receive|send)' in relay
assert 'route_forbidden' in relay

print("yellowcard production Send execution audit passed")

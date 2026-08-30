#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
edge = (ROOT / "supabase/functions/yellowcard-receive/index.ts").read_text()
send = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
receive = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()
errors = (ROOT / "utils/errors/friendlyError.ts").read_text()
api = (ROOT / "utils/api/backendAPI.ts").read_text()

assert 'if (!provider.ok && provider.status >= 500)' in edge
assert 'code: "provider_confirmation_pending"' in edge
assert "reconciled.status === 404" in edge
assert 'code: "yellow_card_transaction_not_created"' in edge
assert 'provider_status: "not_created"' in edge
assert 'provider_status: "confirmation_pending"' in edge
assert 'status: "submitted"' in edge
assert 'Do not submit this transfer again.' in send
assert 'Do not submit this collection again.' in receive
assert "setTransactionPending(pendingConfirmation)" in send
assert "res?.code === 'provider_confirmation_pending'" in receive
assert 'Request timed out. Please try again.' not in errors
assert 'Request timed out. Please try again.' not in api
assert 'We could not confirm the response. Please try again.' in errors

print("yellowcard honest submission state audit passed")

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FLOW = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
RECEIVE_FLOW = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()
EDGE = (ROOT / "supabase/functions/yellowcard-sandbox-transaction/index.ts").read_text()

failures = []

required_flow = [
    "yellowCardSequenceRef",
    "const intentFingerprint = JSON.stringify(request)",
    "sequence_id: sequenceId",
]
for marker in required_flow:
    if marker not in FLOW:
        failures.append(f"send flow is missing retry-idempotency marker: {marker}")

create_block = FLOW.split("action: 'create_send'", 1)[1].split("operator_confirmed: true", 1)[0]
if "randomUUID()" in create_block:
    failures.append("create_send must not generate a fresh Yellow Card sequence on every retry")

required_receive_flow = [
    "collectionSequenceRef.current?.fingerprint !== intentFingerprint",
    "sequence_id: collectionSequenceRef.current.sequenceId",
]
for marker in required_receive_flow:
    if marker not in RECEIVE_FLOW:
        failures.append(f"receive flow is missing retry-idempotency marker: {marker}")

receive_create_block = RECEIVE_FLOW.split("action: 'create_receive'", 1)[1].split("operator_confirmed: true", 1)[0]
if "randomUUID()" in receive_create_block:
    failures.append("create_receive must not generate a fresh Yellow Card sequence on every retry")

required_edge = [
    'if (!prior.provider_transaction_id)',
    '/send/sequence-id/${encodeURIComponent(sequenceId)}',
    'code: "idempotent_reconciled"',
]
for marker in required_edge:
    if marker not in EDGE:
        failures.append(f"edge function is missing reconciliation marker: {marker}")

if failures:
    print("\n".join(failures))
    raise SystemExit(1)

print("Yellow Card retry idempotency and reconciliation gates are present.")

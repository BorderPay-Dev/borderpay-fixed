from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FLOW = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
RECEIVE_FLOW = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()
EDGE = (ROOT / "supabase/functions/yellowcard-transaction/index.ts").read_text()
JIT_EDGE = (ROOT / "supabase/functions/yellowcard-jit-payout/index.ts").read_text()

failures = []

required_flow = [
    "yellowCardJitPayout",
    "idempotency_key: transferIdempotencyKey",
    "}, transferIdempotencyKey)",
]
for marker in required_flow:
    if marker not in FLOW:
        failures.append(f"send flow is missing retry-idempotency marker: {marker}")

if "sequence_id: globalThis.crypto.randomUUID()" in FLOW:
    failures.append("create_send must not submit a fresh Yellow Card sequence on every retry")

for marker in (
    'req.headers.get("Idempotency-Key")',
    '.eq("user_id", access.user.id).eq("idempotency_key", idempotencyKey)',
    'code: "idempotent_replay"',
):
    if marker not in JIT_EDGE:
        failures.append(f"JIT endpoint is missing idempotency marker: {marker}")

required_receive_flow = [
    "collectionSequenceRef.current?.fingerprint !== intentFingerprint",
    "sequence_id: collectionSequenceRef.current.sequenceId",
]
for marker in required_receive_flow:
    if marker not in RECEIVE_FLOW:
        failures.append(f"receive flow is missing retry-idempotency marker: {marker}")

if "sequence_id: crypto.randomUUID()" in RECEIVE_FLOW:
    failures.append("create_receive must not submit a fresh Yellow Card sequence on every retry")

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

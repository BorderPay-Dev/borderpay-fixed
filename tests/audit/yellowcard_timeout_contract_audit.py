from pathlib import Path

root = Path(__file__).resolve().parents[2]
api = (root / "utils/api/backendAPI.ts").read_text()
edge = (root / "supabase/functions/yellowcard-receive/index.ts").read_text()
worker = (root / "supabase/functions/yellowcard-jit-worker/index.ts").read_text()

assert "if (endpoint === 'yellowcard-capabilities') return 30000;" in api
assert "if (endpoint === 'yellowcard-receive') return 90000;" in api
assert "if (endpoint === 'yellowcard-jit-payout') return 45000;" in api
parallel_start = edge.index("const [channelsResult, networksResult, ratesResult] = await Promise.all([")
parallel_end = edge.index("]);", parallel_start)
parallel_block = edge[parallel_start:parallel_end]
assert 'path: "/channels"' in parallel_block
assert 'path: "/networks"' in parallel_block
assert 'path: "/rates"' in parallel_block
assert "timeoutMs: 45_000" in edge
assert "yellowCardReadWithRetry" in edge
assert 'code: "provider_confirmation_pending"' in edge
assert 'provider_status: "confirmation_pending"' in edge
assert 'status: "submitted"' in edge
assert 'provider.status >= 500' in edge
assert 'status: "failed"' in edge
assert '`/receive/sequence-id/${encodeURIComponent(sequenceId)}`' in edge
assert '`/send/sequence-id/${encodeURIComponent(row.sequence_id)}`' in worker

print("Yellow Card timeout and idempotency contract passed.")

from pathlib import Path

root = Path(__file__).resolve().parents[2]
api = (root / "utils/api/backendAPI.ts").read_text()
edge = (root / "supabase/functions/yellowcard-sandbox-transaction/index.ts").read_text()

assert "if (endpoint === 'yellowcard-capabilities') return 30000;" in api
assert "if (endpoint === 'yellowcard-sandbox-transaction') return 90000;" in api
assert "const [channelsResult, networksResult] = await Promise.all([" in edge
assert "timeoutMs: 45_000" in edge
assert "yellowCardReadWithRetry" in edge
assert 'code: "provider_confirmation_pending"' in edge
assert 'provider_status: "confirmation_pending"' in edge
assert 'status: "submitted"' in edge
assert 'provider.status >= 500' in edge
assert 'status: "failed"' in edge
assert '`/send/sequence-id/${encodeURIComponent(sequenceId)}`' in edge
assert '`/receive/sequence-id/${encodeURIComponent(sequenceId)}`' in edge

print("Yellow Card timeout and idempotency contract passed.")

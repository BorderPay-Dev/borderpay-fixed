# Virtual account instruction boundary

The production bridge-virtual-account function was version 384 when reconciled on 2026-09-20. Its 11 local source-map modules were compared byte-for-byte to the captured live graph before this change. PROVENANCE.json records the original and compiled SHA-256 values.

The preserved graph lives under bridge-virtual-account/production-v384. TypeScript syntax was erased with TypeScript targeting ESNext. Relative imports use .js; the entry point exports its existing handler instead of calling Deno.serve. The existing enrollment, pilot, fee, status, idempotency, inactive-account and Base routing behavior remains inside that graph. Canonical shared modules used by other functions are not replaced.

The new typed entry point authenticates the customer, retains the repository's restricted-account guard, checks the invoice policy before provider work, invokes the preserved handler, and checks policy again before returning. When required, it strips bank coordinates and account-letter links recursively. It does not strip stablecoin addresses or account labels. Errors and non-JSON payloads cannot expose coordinates. Responses are not cached.

Tests cover disabled compatibility, unchanged request body, policy changes during a request, denied identities, restricted accounts, unavailable policy before/after provider work and malformed responses.

This closes one response surface. Deploy gateway and account-sync filters with the same read-boundary release. Previously distributed bank details cannot be recalled; signed deposit reconciliation is still required.

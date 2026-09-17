# Founder treasury verification

Run from the repository root:

```sh
deno test --no-lock tests/treasury/*.test.ts
deno check supabase/functions/bridge-operator-readonly/index.ts
npm run type-check
python3 tests/audit/operator_bridge_readonly_app_audit.py
python3 tests/audit/operator_treasury_live_ledger_audit.py
python3 tests/audit/operator_bridge_frontend_audit.py
python3 tests/audit/operator_treasury_pwa_audit.py
```

Browser fixtures deliberately replace only the treasury API. They contain no real
customer identifiers, credentials or money movement. Start the isolated harness:

```sh
npx vite --config tests/treasury/browser/vite.config.ts
# With Playwright installed in the environment:
node tests/treasury/browser/check.mjs
node tests/treasury/browser/chart.mjs
```

`PLAYWRIGHT_MODULE` can point to an existing Playwright module. The runner uses
installed Google Chrome on macOS. `TREASURY_SCREENSHOTS` selects an output folder.
The production app never imports the fixture entry or fixture API.

Coverage: desktop / mobile navigation; GBP sort code; activity search and status
filter; unavailable balances; currency separation; amount-above-balance rejection;
PIN review and one fixture submission; failed refresh preserves existing data;
refresh recovery; 320px overflow; slow body/auth deadlines; no automatic transfer retry.

USD valuation: founder-only per-token balances use current Bridge EUR/USD and
USDT/USD midmarket rates (USDC at nominal USD parity). VAs are receiving rails,
not balances. Both Home totals use the same server valuation. History uses Bridge
wallet after-event balances, valued at current rates; it is suppressed if partial
or inconsistent with live balances. Activity preserves original and settled units.
No schema migration is required.

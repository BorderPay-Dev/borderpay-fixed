#!/usr/bin/env python3
"""Founder treasury UI boundaries; behavior is exercised by tests/treasury."""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
UI = (ROOT / 'components/business/OperatorBridgeReadOnlyApp.tsx').read_text()
CSS = (ROOT / 'components/business/treasury/treasury.css').read_text()
VALUES = (ROOT / 'components/business/treasury/values.ts').read_text()
API = (ROOT / 'components/business/treasury/api.ts').read_text()
REQUEST = (ROOT / 'components/business/treasury/request.ts').read_text()
APP = (ROOT / 'App.tsx').read_text()
checks = {
 'founder retains separate route': 'founder@borderpayafrica.com' in APP and '<OperatorBridgeReadOnlyApp' in APP,
 'all five financial destinations': all(f"activeView === '{v}'" in UI for v in ['home','wallets','receive','transactions','send']),
 'desktop and mobile navigation': 'treasury-desktop-nav' in CSS and 'Mobile treasury navigation' in UI,
 'active page announced': "aria-current={activeView === id ? 'page'" in UI,
 'treasury-only endpoint': 'bridge-operator-readonly' in API and 'treasuryAPI.getSnapshot' in UI and 'treasuryAPI.send' in UI,
 'business app visual structure': all(token in UI for token in ['treasury-business-identity', 'treasury-business-balance', 'treasury-account-strip', 'treasury-quick-actions']) and 'treasury-sidebar' not in UI,
 'bounded transport includes body': 'Promise.race' in REQUEST and 'await response.json()' in REQUEST and '45_000' in REQUEST,
 'no automatic mutation retry': 'retries:' not in REQUEST and 'could not be confirmed' in REQUEST,
 'refreshes cannot overlap': 'if (reading.current) return' in UI,
 'unavailable balances stay unknown': 'if (!wallet.balance_available) return null' in VALUES and 'wallet.balance !== null' in UI,
 'separate asset units': 'USDC + USDT' in UI and 'EURC shown separately' in UI,
 'visible sort code': 'formatSortCode(account.sort_code || account.routing_number)' in UI,
 'activity filter and search': 'Search treasury activity' in UI and 'Filter activity status' in UI,
 'source and destination retain currency': 'formatMoney(row.source.amount, row.source.currency)' in UI and 'formatMoney(row.destination.amount, row.destination.currency)' in UI,
 'live transfer guards retained in UI': 'idempotency_key: idempotencyKey' in UI and 'if (!selectedSource || submitting.current) return' in UI,
 'no consumer components or provider secrets': all(x not in UI+API for x in ['MainApp','BusinessDashboard','BRIDGE_API_KEY']),
 'treasury does not change SCA': all(x not in UI for x in ['SCAChallengeDialog','authorizeSCA','sca_authorization_id']),
 'scoped styling': '.bp-treasury-shell' in CSS and '#root{' not in CSS,
}
for name, passed in checks.items(): print(('PASS' if passed else 'FAIL') + ': ' + name)
if not all(checks.values()): raise SystemExit(1)
print(f'PASS: {len(checks)}/{len(checks)} founder treasury frontend invariants')

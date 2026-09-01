from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "supabase/functions/bridge-reconcile-customers/index.ts").read_text()
STATE = (ROOT / "supabase/functions/_shared/bridge-customer-state.ts").read_text()
MIGRATION = (ROOT / "supabase/migrations/20260901113000_bridge_customer_authoritative_reconciliation.sql").read_text()

required = [
    'bridgeProvider.getCustomerProfile',
    'error.status === 404',
    'bridge_account_status: "offboarded"',
    'bridge_verification_status: states.verification_status',
    'bridge_kyb_status: bridgeKycColumn(states.verification_status)',
    'bridge_virtual_accounts").update({ status: "closed"',
    'bridge_wallets").update({ status: "closed"',
    'bridge_external_accounts").update({ status: "deleted", active: false',
    'db.from("business_profiles")',
    '.slice(offset, offset + limit)',
]

for marker in required:
    assert marker in SOURCE, f"missing reconciliation invariant: {marker}"

for forbidden in [
    'createTransfer(',
    'createCustomer(',
    'createVirtualAccount(',
    'createWallet(',
    'send-email',
]:
    assert forbidden not in SOURCE, f"read-only reconciliation contains forbidden action: {forbidden}"

assert 'return "incomplete";' in STATE
NORMALIZER = STATE.split('export function normalizeBridgeCustomerState', 1)[1].split('function first', 1)[0]
assert NORMALIZER.rstrip().endswith('return "incomplete";\n}')
assert "*/5 * * * *" in MIGRATION
assert "'dry_run', false" in MIGRATION
assert "create or replace function public.invoke_bridge_customer_reconcile_batch()" in MIGRATION
assert "from public.business_profiles bp" in MIGRATION
assert "union" in MIGRATION

print("bridge_customer_reconcile_audit: PASS")

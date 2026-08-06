#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
worker = (ROOT / "supabase/functions/deactivate-inactive-virtual-accounts/index.ts").read_text()
provider = (ROOT / "supabase/functions/_shared/providers/bridge.ts").read_text()
create = (ROOT / "supabase/functions/bridge-virtual-account/index.ts").read_text()
sync = (ROOT / "supabase/functions/bridge-sync-accounts/index.ts").read_text()
migration = (ROOT / "supabase/migrations/20260806150000_inactive_virtual_account_lifecycle.sql").read_text()
registry = (ROOT / "supabase/functions/_shared/email-templates/index.ts").read_text()
dashboard = (ROOT / "components/dashboard/bridge/BridgeVirtualAccountsCard.tsx").read_text()

required_worker = [
    "const INACTIVITY_DAYS = 30",
    '.lte("activated_at", cutoff)',
    'from("bridge_balance_ledger")',
    '.eq("provider", "bridge")',
    '.eq("direction", "credit")',
    '.gt("amount_minor", 0)',
    '.in("currency", ["USD", "EUR", "GBP", "USDC", "USDT"])',
    '.in("entity_type", ["virtual_account", "wallet"])',
    "qualifying_incoming_received",
    "incoming_funds_lookup_failed",
    "bridgeProvider.deactivateVirtualAccount",
    'status: "deactivated"',
    'deactivation_reason: "30_day_inactivity"',
    'idempotency_key: `va-inactive:',
    "retryPendingEmails",
]
for marker in required_worker:
    assert marker in worker, f"missing inactivity worker contract: {marker}"

for forbidden in ['from("transactions")', 'from("bridge_transfers")', "last_sign_in_at", 'provider", "demo']:
    assert forbidden not in worker, f"non-incoming activity must not protect unused VAs: {forbidden}"

assert "/virtual_accounts/${encodeURIComponent(virtualAccountId)}/deactivate" in provider
assert "reactivateVirtualAccount(" not in create, "customer VA creation must not self-reactivate inactive accounts"
assert 'code: "virtual_account_inactive"' in create
assert "reactivatedBySupport" in sync and "activated_at" in sync
assert "deactivate-inactive-virtual-accounts" in migration
assert "15 3 * * *" in migration
assert "bridge_virtual_accounts_status_check" in migration and "'deactivated'" in migration
assert "individual.virtual_account_inactive" in registry
assert "business.virtual_account_inactive" in registry
assert "An inactive receiving account cannot accept new payments" in dashboard
assert "Contact support" in dashboard

print("virtual account inactivity lifecycle audit passed")

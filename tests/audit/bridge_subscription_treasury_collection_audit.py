#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
worker = (ROOT / "supabase/functions/subscription-billing-worker/index.ts").read_text()
collector = (ROOT / "supabase/functions/subscription-bridge-collection/index.ts").read_text()
processor = (ROOT / "supabase/functions/process-pending-events/index.ts").read_text()
migration = (ROOT / "supabase/migrations/20260830235500_bridge_subscription_treasury_collection.sql").read_text()
transfer_handler = processor[processor.find("async function handleBridgeTransfer"):]

checks = {
    "worker uses provider-backed collector": "functions/v1/subscription-bridge-collection" in worker,
    "legacy internal ledger collection removed from worker": "charge_internal_subscription" not in worker,
    "collector independently rejects non-authoritative geography": 'scope.reason !== "non_eea"' in collector,
    "customer custodial wallet is Bridge source": 'payment_rail: "bridge_wallet"' in collector,
    "Bridge API balance is authoritative before collection": "getWalletBalances" in collector
    and "p_provider_balances" in collector and "p_provider_balances" in migration,
    "corporate whitelist is transfer destination": "destination_address" in collector and "maintenance_wallet_whitelist" in migration,
    "only canonical USDC/Base and USDT/Tron routes are accepted": 'asset === "USDC" && network === "BASE"' in collector
    and 'asset === "USDT" && network === "TRON"' in collector,
    "maintenance transfer has no developer fee": "developer_fee: undefined" in collector,
    "Bridge idempotency is stable per collection leg": "subscription-maintenance:${prepared.collection_id}:${leg.id}" in collector,
    "provider submission cannot mark subscription paid": "record_bridge_subscription_collection_submission" in collector
    and "complete_external_subscription_invoice" not in collector,
    "signed webhook owns terminal reconciliation": "reconcile_bridge_subscription_collection_leg" in processor,
    "maintenance transfer bypasses generic revenue and email pipeline": transfer_handler.find("subscription_bridge_collection_legs")
    < transfer_handler.find("hasExplicitBridgeDeveloperFee"),
    "all legs must complete before paid state": "status<>'completed'" in migration
    and "subscription.payment.completed" in migration,
    "failed provider lifecycle does not advance billing date": "bridge_transfer_failed" in migration
    and migration.find("bridge_transfer_failed") < migration.find("subscription_next_month_end"),
    "SQL RPCs are service-role only": migration.count("grant execute on function public.") >= 3
    and "from public,anon,authenticated" in migration,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"[{'PASS' if passed else 'FAIL'}] {name}")
if failed:
    raise SystemExit(f"bridge subscription treasury audit failed: {', '.join(failed)}")
print(f"bridge subscription treasury audit: PASS ({len(checks)}/{len(checks)})")

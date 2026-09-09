#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20260818200000_provider_revenue_ledger.sql"
WEBHOOK_MIGRATION = ROOT / "supabase/migrations/20260819090000_bridge_webhook_revenue_capture.sql"
REFUND_MIGRATION = ROOT / "supabase/migrations/20260819103000_bridge_refund_revenue_reconciliation.sql"
WORKER = ROOT / "supabase/functions/process-pending-events/index.ts"
TEST = ROOT / "tests/provider-revenue-db.sql"

migration = MIGRATION.read_text(encoding="utf-8")
webhook_migration = WEBHOOK_MIGRATION.read_text(encoding="utf-8")
refund_migration = REFUND_MIGRATION.read_text(encoding="utf-8")
worker = WORKER.read_text(encoding="utf-8")
db_test = TEST.read_text(encoding="utf-8")
nonterminal_credit_branch = worker.split("const approvedReceipt = bridgeVaReceiptDetails", 1)[1].split("if (deliversToExternalWallet)", 1)[0]

checks = {
    "immutable provider ledger exists": all(token in migration for token in (
        "create table if not exists public.provider_revenue_events",
        "trg_provider_revenue_events_immutable",
        "append a reversal event",
    )),
    "provider events are idempotent": "unique (provider, environment, source_type, source_id, event_kind, revenue_category)" in migration,
    "only settled evidence is recognized": all(token in migration for token in (
        "provider evidence is required",
        "settlement_status",
        "event_kind = 'earned' and settlement_status = 'settled'",
    )),
    "reversals are separate signed rows": all(token in migration for token in (
        "event_kind = 'reversal'",
        "event_sign",
        "append a reversal event",
    )),
    "same-token stablecoin routes enforce zero revenue": all(token in migration for token in (
        "source_currency in ('USDC', 'USDT')",
        "same-token USDC/USDT transfer revenue must be zero",
    )),
    "ordinary virtual-account debits are excluded": all(token in migration for token in (
        "v_status in ('canceled', 'refunded', 'returned', 'reversed')",
        "Ordinary debits are not proof",
    )),
    "historical Bridge evidence is backfilled without estimates": all(token in migration for token in (
        "Existing virtual-account rows are backfilled only when",
        "evidence.fee_amount is not null",
        "Configuration percentages are not",
    )),
    "projection triggers no longer own revenue recognition": all(token in webhook_migration for token in (
        "drop trigger if exists trg_capture_bridge_transfer_revenue",
        "drop trigger if exists trg_capture_bridge_va_revenue",
        "Projection tables remain useful read models",
    )),
    "signed completed Bridge webhooks are authoritative": all(token in webhook_migration for token in (
        "e.signature_ok = true",
        "join public.pending_events q on q.id = e.pending_event_id and q.status = 'completed'",
        "'source','bridge_webhook_events'",
        "Configured percentages are intentionally never substituted",
    )),
    "worker records webhook fee evidence for VA and transfers": all(token in worker for token in (
        "recordBridgeWebhookRevenue",
        'sourceType: "bridge_virtual_account"',
        'sourceType: "bridge_transfer"',
        'source: "bridge_webhook_events"',
        "hasExplicitBridgeDeveloperFee",
    )),
    "worker reverses refunded VA and transfer revenue": all(token in worker for token in (
        "async function reverseBridgeWebhookRevenue",
        'eventKind: "reversal"',
        'if (nonCreditStatus === "refunded" || nonCreditStatus === "canceled")',
        'if (transferState === "refunded" || transferState === "returned")',
    )),
    "failed transactions never earn revenue":
        'if (transferState === "succeeded" && hasExplicitBridgeDeveloperFee(d))' in worker,
    "nonterminal fiat credits never earn revenue":
        "recordBridgeWebhookRevenue" not in nonterminal_credit_branch and
        "not terminal" in nonterminal_credit_branch,
    "historical refunds reverse only prior earned revenue": all(token in refund_migration for token in (
        "b.signature_ok = true",
        "q.status = 'completed'",
        "join public.provider_revenue_events earned",
        "earned.event_kind = 'earned'",
        "'reversal'",
        "on conflict do nothing",
    )),
    "coverage fails visibly when webhook evidence is incomplete": all(token in webhook_migration for token in (
        "missing_fee_evidence_sources",
        "uncaptured_fee_evidence_sources",
        "source_volume_by_currency",
        "weekly_actual_by_currency",
        "recent_terminal_sources",
        "admin_bridge_revenue_webhook_coverage",
    )),
    "sandbox events are excluded from admin totals": "where environment = 'live'" in migration,
    "non-USD conversion is never inferred from ambiguous provider FX": "case when coalesce(v_source_currency, upper(new.currency)) in ('USD','USDC','USDT') then 1::numeric else null end" in migration,
    "Yellow Card unavailable state is explicit": "unavailable_live_execution_not_implemented" in migration,
    "admin summary is server-authorized": all(token in migration for token in (
        "public.admin_provider_revenue_summary()",
        "admin access required",
        "grant execute on function public.admin_provider_revenue_summary() to authenticated, service_role",
    )),
    "focused regression covers provider lifecycle": all(token in db_test for token in (
        "revenue idempotency failed",
        "revenue reversal was not appended",
        "ordinary virtual-account debit was misclassified",
        "sandbox Yellow Card revenue leaked",
        "uncaptured signed fee evidence was not reported",
        "missing signed fee evidence was not reported",
    )),
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit(1)
print("provider revenue ledger audit: PASS")

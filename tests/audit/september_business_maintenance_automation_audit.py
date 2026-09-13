from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
migration = (ROOT / "supabase/migrations/20260913113000_current_month_business_maintenance.sql").read_text()
worker = (ROOT / "supabase/functions/subscription-billing-worker/index.ts").read_text()
fee_migration = (ROOT / "supabase/migrations/20260824170000_business_maintenance_fee_september_2026.sql").read_text()

checks = {
    "current month-end helper exists": "subscription_current_month_end" in migration,
    "month-end input is validated": "Billing period must be the final day" in migration,
    "business-only eligibility": "up.account_type::text" in migration and "= 'business'" in migration,
    "profile verification required": "up.kyc_status::text" in migration and "= 'verified'" in migration,
    "KYB approval required": "bp.bridge_kyb_status::text" in migration and "('approved', 'verified')" in migration,
    "deleted auth users excluded": "au.deleted_at is null" in migration,
    "paused accounts excluded": "'paused'" in migration,
    "frozen accounts excluded": "'frozen'" in migration,
    "offboarded accounts excluded": "'offboarded'" in migration,
    "rejected accounts excluded": "'rejected'" in migration,
    "dry run supported": "p_dry_run boolean default true" in migration,
    "September is prepared through current month-end": "currentMonthEnd()" in worker,
    "approval trigger uses current month": "public.subscription_current_month_end(current_date)" in migration,
    "individual legacy timing preserved": "public.subscription_next_month_end(current_date)" in migration,
    "service-role-only sync": "grant execute on function public.sync_approved_business_maintenance_subscriptions" in migration,
    "worker prepares approved businesses": "prepareApprovedBusinessBilling" in worker,
    "worker calls server-side sync": 'db.rpc("sync_approved_business_maintenance_subscriptions"' in worker,
    "worker selects business subscriptions": '.eq("account_type", "business")' in worker,
    "all business invoices use external collection": 'route: "flutterwave_invoice"' in worker,
    "invoice queue is database-idempotent": 'db.rpc("queue_external_subscription_invoice"' in worker,
    "country must be authoritative ISO2": '/^[A-Z]{2}$/' in worker,
    "EEA countries remain represented": '"AT", "BE", "BG", "HR", "CY", "CZ"' in worker,
    "billing route is independent from SCA": "Billing routing is intentionally independent from SCA" in worker,
    "blocked identity fails closed": "maintenance_identity_or_country_unresolved" in worker,
    "daily billing invokes preparation": '["prepare", "bill_due", "drain"]' in worker,
    "dry-run endpoint exists": 'mode === "prepare_dry_run"' in worker,
    "migration does not auto-run a financial batch": "select public.sync_approved_business_maintenance_subscriptions(" not in migration,
    "business is not double processed by legacy billing": '.neq("account_type", "business")' in worker,
    "reference prefix remains enforced": "bp-maintenance-${invoice.id}" in (ROOT / "supabase/functions/flutterwave-subscription-collection/index.ts").read_text(),
    "September business fee is 29.99": "return 29.99" in fee_migration,
    "August business fee remains 15": "return 15.00" in fee_migration,
    "historical individual fee remains 5": "return 5.00" in fee_migration,
    "fee follows billing period": "subscriptions_apply_period_fee" in fee_migration,
    "fee migration does not collect funds": "charge_internal_subscription" not in fee_migration,
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("business maintenance automation audit failed: " + ", ".join(failed))

print(f"business maintenance automation audit passed ({len(checks)}/{len(checks)})")

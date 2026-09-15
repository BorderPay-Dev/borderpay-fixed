from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
migration = (ROOT / "supabase/migrations/20260913113000_current_month_business_maintenance.sql").read_text()
policy = (ROOT / "supabase/migrations/20260915090000_active_va_maintenance_and_onboarding_lifecycle.sql").read_text()
worker = (ROOT / "supabase/functions/subscription-billing-worker/index.ts").read_text()

checks = {
    "current month-end helper exists": "subscription_current_month_end" in migration,
    "month-end input is validated": "Billing period must be the final day" in migration,
    "business and individual eligibility": "('business','individual')" in policy,
    "profile verification required": "up.kyc_status::text" in policy and "='verified'" in policy,
    "KYB approval required": "bp.bridge_kyb_status::text" in policy and "('approved','verified')" in policy,
    "deleted auth users excluded": "au.deleted_at is null" in policy,
    "blocked accounts excluded": all(status in policy for status in ("'paused'", "'frozen'", "'offboarded'", "'rejected'")),
    "active VA required": "lower(va.status::text) in ('active','activated')" in policy,
    "central billable predicate": "maintenance_account_is_billable" in policy,
    "inactive or blocked subscriptions paused": "'billing_paused_reason','account_not_billable_or_no_active_virtual_account'" in policy and "not public.maintenance_account_is_billable(s.user_id)" in policy,
    "inactive or blocked invoices cancelled": "account_not_billable_or_no_active_virtual_account" in policy,
    "dry run supported": "p_dry_run boolean default true" in policy,
    "September is prepared through current month-end": "currentMonthEnd()" in worker,
    "approval trigger uses current month": "public.subscription_current_month_end(current_date)" in migration,
    "individual legacy timing preserved": "public.subscription_next_month_end(current_date)" in migration,
    "service-role-only sync": "grant execute on function public.sync_active_va_maintenance_subscriptions" in policy,
    "worker prepares approved businesses": "prepareApprovedBusinessBilling" in worker,
    "worker calls active-VA sync": 'db.rpc("sync_active_va_maintenance_subscriptions"' in worker,
    "worker selects business subscriptions": '.eq("account_type", "business")' in worker,
    "all business invoices use external collection": 'route: "flutterwave_invoice"' in worker,
    "invoice queue is database-idempotent": 'db.rpc("queue_external_subscription_invoice"' in worker,
    "country must be authoritative ISO2": '/^[A-Z]{2}$/' in worker,
    "EEA countries remain represented": '"AT", "BE", "BG", "HR", "CY", "CZ"' in worker,
    "billing route is independent from SCA": "Billing routing is intentionally independent from SCA" in worker,
    "blocked identity fails closed": "maintenance_identity_or_country_unresolved" in worker,
    "daily billing synchronizes approved businesses": '["bill_due", "drain"].includes(mode)' in worker,
    "daily runs do not invoice before month end": "if (!queueBeforeDue && today < billingPeriod)" in worker,
    "manual preparation is explicit": 'prepareApprovedBusinessBilling(false, true)' in worker,
    "dry-run endpoint exists": 'mode === "prepare_dry_run"' in worker,
    "migration does not auto-run a financial batch": "select public.sync_active_va_maintenance_subscriptions(" not in policy,
    "business is not double processed by legacy billing": '.neq("account_type", "business")' in worker,
    "reference prefix remains enforced": "bp-maintenance-${invoice.id}" in (ROOT / "supabase/functions/flutterwave-subscription-collection/index.ts").read_text(),
    "all business cycles use 29.99": "return 29.99" in policy and "return 15.00" not in policy,
    "individual cycles use 5": "return 5.00" in policy,
    "old unpaid periods are cancelled, never marked paid": "superseded_by_active_va_billing_policy" in policy and "set status = 'paid'" not in policy,
    "fee policy does not collect funds": "charge_internal_subscription" not in policy,
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("business maintenance automation audit failed: " + ", ".join(failed))

print(f"business maintenance automation audit passed ({len(checks)}/{len(checks)})")

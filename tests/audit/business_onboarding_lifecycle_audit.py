#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (ROOT / "supabase/migrations/20260915090000_active_va_maintenance_and_onboarding_lifecycle.sql").read_text()
WORKER = (ROOT / "supabase/functions/subscription-billing-worker/index.ts").read_text()
REGISTRY = (ROOT / "supabase/functions/_shared/email-templates/index.ts").read_text()
TEMPLATE = (ROOT / "supabase/functions/_shared/email-templates/business/onboarding-lifecycle.ts").read_text()

checks = {
    "business-only lifecycle": "lower(up.account_type::text)='business'" in MIGRATION,
    "only not-started or incomplete": "in ('not_started','incomplete')" in MIGRATION,
    "approved and review states are excluded": all(status not in MIGRATION.split("run_business_onboarding_lifecycle$")[1].split("$run_business_onboarding_lifecycle$;")[0] for status in ("'approved'", "'under_review'", "'awaiting_ubo'")),
    "five exact lifecycle days": "lifecycle_day in (1,3,7,21,30)" in MIGRATION,
    "day 1 welcome": "target_day=1 then 'welcome'" in MIGRATION,
    "day 3 and 7 reminders": "target_day in (3,7) then 'reminder'" in MIGRATION,
    "day 21 warning": "target_day=21 then 'warning'" in MIGRATION,
    "day 30 freeze": "target_day=30" in MIGRATION and "account_status='frozen'" in MIGRATION,
    "records are retained": "delete from public.user_profiles" not in MIGRATION and "delete from auth.users" not in MIGRATION,
    "actions are idempotent": "unique(user_id,lifecycle_day)" in MIGRATION and "on conflict(user_id,lifecycle_day) do nothing" in MIGRATION,
    "email jobs are idempotent": "business:onboarding:day" in MIGRATION and "on conflict(idempotency_key) do nothing" in MIGRATION,
    "in-app notification is queued": "insert into public.notifications" in MIGRATION,
    "dry run is available": "p_dry_run boolean default true" in MIGRATION,
    "worker executes lifecycle daily": '["bill_due", "drain", "onboarding"].includes(mode)' in WORKER,
    "manual dry run mode exists": 'mode === "onboarding_dry_run"' in WORKER,
    "email template registered": '"business.onboarding_lifecycle"' in REGISTRY,
    "all five email stages exist": all(f"day_{day}" in TEMPLATE for day in (1, 3, 7, 21, 30)),
    "day 30 email says frozen not deleted": "has been frozen" in TEMPLATE and "record was not deleted" in TEMPLATE,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("business onboarding lifecycle audit failed: " + ", ".join(failed))
print(f"business onboarding lifecycle audit passed ({len(checks)}/{len(checks)})")

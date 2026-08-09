#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = (ROOT / "supabase/functions/_shared/email-templates/index.ts").read_text()
WORKER = (ROOT / "supabase/functions/process-pending-events/index.ts").read_text()
INDIVIDUAL = (ROOT / "supabase/functions/_shared/email-templates/individual/account-maintenance-fee.ts").read_text()
BUSINESS = (ROOT / "supabase/functions/_shared/email-templates/business/account-maintenance-fee.ts").read_text()

checks = {
    "individual template registered": '"individual.account_maintenance_fee"' in REGISTRY,
    "business template registered": '"business.account_maintenance_fee"' in REGISTRY,
    "individual fee is $5 only": "$5" in INDIVIDUAL and "$15" not in INDIVIDUAL,
    "business fee is $15 only": "$15" in BUSINESS and "$5" not in BUSINESS,
    "separate approval helper": "emailAccountMaintenanceFeeBestEffort" in WORKER,
    "approval-only send": 'if (normalized === "approved")' in WORKER,
    "dedupe key": "wh:account-maintenance-approved:${userId}:v1" in WORKER,
    "month-end billing date": "currentMonthEndDate()" in WORKER,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    print("VERIFICATION MAINTENANCE EMAIL AUDIT: FAIL")
    for name in failed:
        print(f"  ✗ {name}")
    raise SystemExit(1)

print("VERIFICATION MAINTENANCE EMAIL AUDIT: PASS")
for name in checks:
    print(f"  ✓ {name}")

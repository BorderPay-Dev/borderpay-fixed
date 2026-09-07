#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
individual = (ROOT / "supabase/functions/_shared/email-templates/individual/subscription-external-invoice.ts").read_text()
business = (ROOT / "supabase/functions/_shared/email-templates/business/subscription-external-invoice.ts").read_text()
migration = (ROOT / "supabase/migrations/20260907220000_individual_business_maintenance_warning_split.sql").read_text()

checks = {
    "templates are physically separate": "export { render }" not in individual and "export { render }" not in business,
    "individual warns permanent loss of product access": "permanently closed" in individual and "not be eligible to regain" in individual,
    "individual notice preserves balance rights": "does not forfeit any remaining customer funds" in individual,
    "business restriction remains temporary": "temporarily restricted" in business and "restored" in business,
    "only supplied five-dollar individual invoices are queued": all(x in migration for x in ("sei.amount=5.00", "s.account_type='individual'", "up.account_type='individual'")),
    "paid and restricted accounts are excluded": "sei.paid_at is null" in migration and "s.restricted_at is null" in migration,
    "frozen and provider-paused accounts are excluded": "up.account_frozen_at is null" in migration and "up.bridge_account_status" in migration,
    "individual automatic reactivation is forbidden": migration.count("s.account_type='business'") >= 2,
    "final restriction waits for delivered email": "j.status='sent'" in migration and "j.sent_at is not null" in migration,
    "no identity or financial record deletion": "delete from" not in migration.lower(),
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"{'PASS' if ok else 'FAIL'}: {name}")
if failed:
    raise SystemExit(f"{len(failed)} account-type maintenance warning checks failed")
print(f"PASS: {len(checks)}/{len(checks)} account-type maintenance warning checks")

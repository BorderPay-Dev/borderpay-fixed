from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
fn = (ROOT / "supabase/functions/eur-named-account-broadcast/index.ts").read_text()
template = (ROOT / "supabase/functions/_shared/email-templates/account/eur-named-account-announcement.ts").read_text()

checks = {
    "admin authorization": '.from("admin_users")' in fn and "Admin access required" in fn,
    "explicit send confirmation": 'SEND_EUR_NAMED_ACCOUNT_NOTICE' in fn,
    "thirty recipient maximum": "const BATCH_SIZE = 30" in fn,
    "EUR account ownership targeting": '.from("bridge_virtual_accounts")' in fn and '.ilike("currency", "eur")' in fn,
    "active-account targeting": '.in("status", ["active", "activated", "enabled"])' in fn,
    "dry-run support": "if (dryRun)" in fn,
    "idempotent per-recipient delivery": "idempotency_key: `broadcast:${CAMPAIGN}:${recipient.user_id}`" in fn,
    "IBAN unchanged copy": "EUR IBAN is not changing" in template,
    "beneficiary action copy": "registered business name as the beneficiary" in template,
    "maintenance window copy": "8:00 AM to 2:00 PM Eastern Time" in template,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    print("eur_named_account_broadcast_audit: FAIL")
    for name in failed:
        print(f"- {name}")
    raise SystemExit(1)

print(f"eur_named_account_broadcast_audit: PASS ({len(checks)}/{len(checks)})")

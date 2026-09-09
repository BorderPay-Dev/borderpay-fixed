from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
worker = (ROOT / "supabase/functions/individual-policy-broadcast/index.ts").read_text()
screen = (ROOT / "components/admin/IndividualBroadcastScreen.tsx").read_text()
registry = (ROOT / "supabase/functions/_shared/email-templates/index.ts").read_text()
template = (ROOT / "supabase/functions/_shared/email-templates/individual/business-only-transition.ts").read_text()

checks = {
    "template registered": '"individual.business_only_transition"' in registry,
    "recipient namespace fixed": '.eq("account_type", "individual")' in worker,
    "admins excluded": '.eq("is_admin", false)' in worker,
    "batch hard-capped at 30": "const BATCH_SIZE = 30" in worker,
    "admin_users authorization": '.from("admin_users")' in worker and "admin.is_active !== true" in worker,
    "timing-safe internal authorization": "INDIVIDUAL_POLICY_BROADCAST_TOKEN" in worker and "timingSafeEqualStr" in worker,
    "explicit send confirmation": "SEND_INDIVIDUAL_POLICY_NOTICE" in worker,
    "deterministic idempotency": "`broadcast:${CAMPAIGN_VERSION}:${recipient.user_id}`" in worker,
    "dry run required by UI": "previewedStartIndex !== startIndex" in screen,
    "existing access preserved": "existing Individual account" in template,
    "no 60-day deletion claim": "2 months" not in template and "two months" not in template,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"{'PASS' if ok else 'FAIL'}: {name}")
if failed:
    raise SystemExit(1)
print("individual policy broadcast audit: PASS")

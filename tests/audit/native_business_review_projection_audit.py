from pathlib import Path

root = Path(__file__).resolve().parents[2]
profile = (root / "supabase/functions/get-user-profile/index.ts").read_text()
status = (root / "supabase/functions/kyc-status/index.ts").read_text()
worker = (root / "supabase/functions/process-pending-events/index.ts").read_text()
registry = (root / "supabase/functions/_shared/email-templates/index.ts").read_text()

checks = {
    "profile API projects incomplete business KYB into review":
        'normalizedBusinessKybStatus === "incomplete"' in profile
        and 'clientBusinessKybStatus = operatorReviewRequired ? "under_review"' in profile,
    "account-level UBO state cannot reopen the native CTA":
        'clientBridgeAccountStatus' in profile
        and ': operatorReviewRequired\n        ? "under_review"' in profile,
    "raw provider KYB and account states remain available":
        "bridge_provider_kyb_status: bridgeKybStatus" in profile
        and "bridge_provider_account_status: profile?.bridge_account_status" in profile,
    "status API uses the same business-only projection":
        "const operatorReviewRequired = isBusiness" in status
        and "if (operatorReviewRequired) status = 'under_review'" in status,
    "individual verification logic remains outside the projection":
        "const operatorReviewRequired = isBusiness" in status,
    "UBO follow-up email is idempotent":
        'idempotency_key: `wh:kyb:${userId}:ownership-review`' in worker,
    "both KYB-link and customer-status events can trigger the notice":
        worker.count("emailOwnershipReviewBestEffort") >= 3,
    "ownership review template is registered":
        registry.count('"business.ownership_review"') >= 2,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("Native business review projection audit failed:\n- " + "\n- ".join(failed))
print(f"Native business review projection audit passed ({len(checks)}/{len(checks)})")

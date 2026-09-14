#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
kyb = (ROOT / "supabase/functions/bridge-kyb-link/index.ts").read_text()
worker = (ROOT / "supabase/functions/process-pending-events/index.ts").read_text()
screen = (ROOT / "components/kyc/KYCVerification.tsx").read_text()
environment = (ROOT / "utils/config/environment.ts").read_text()
status_api = (ROOT / "supabase/functions/kyc-status/index.ts").read_text()
backfill = (ROOT / "supabase/migrations/20260914151000_sync_actionable_business_verification_status.sql").read_text()

checks = {
    "existing customer resumes through documented GET": "/customers/${encodeURIComponent(existingCustomerId)}/kyc_link" in kyb,
    "stored link is refreshed through documented GET": "/v0/kyc_links/${encodeURIComponent(biz.bridge_kyb_link_id)}" in kyb,
    "new-link payload never includes customer_id": "reqBody.customer_id" not in kyb,
    "new customer still uses POST kyc_links": '"/v0/kyc_links"' in kyb and "bridgePost(" in kyb,
    "accepted ToS URL is omitted": "tos_link_url: tosRequired ? link.tos_link_url : null" in kyb,
    "worker maps provider UBO state to canonical status": 'status === "awaiting_ubo" ? "needs_ubos"' in worker,
    "worker maps questionnaire state to canonical RFI": 'status === "awaiting_questionnaire" ? "awaiting_rfi"' in worker,
    "verification screen exposes UBO action": "Ownership details required" in screen and "status === 'needs_ubos'" in screen,
    "shared derivation reads account-level UBO truth": "bridgeAcct === 'awaiting_ubo'" in environment,
    "status API preserves actionable UBO state": "status = 'needs_ubos'" in status_api,
    "existing UBO businesses are backfilled": "when 'awaiting_ubo' then 'needs_ubos'" in backfill,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("bridge_kyb_existing_customer_resume_audit failed: " + "; ".join(failed))
print(f"bridge_kyb_existing_customer_resume_audit: PASS ({len(checks)}/{len(checks)})")

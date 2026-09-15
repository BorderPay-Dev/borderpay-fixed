#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
profile = (ROOT / "supabase/functions/get-user-profile/index.ts").read_text()
status = (ROOT / "supabase/functions/kyc-status/index.ts").read_text()
kyb = (ROOT / "supabase/functions/bridge-kyb-link/index.ts").read_text()
screen = (ROOT / "components/kyc/KYCVerification.tsx").read_text()

checks = {
    "retry projection is business-only": 'restartableBusinessVerification = accountType === "business"' in profile,
    "incomplete profile restarts as not_started": 'clientBusinessKybStatus = restartableBusinessVerification ? "not_started"' in profile,
    "status API restarts as draft": "if (restartableBusinessVerification) status = 'draft'" in status,
    "provider status remains available": "bridge_provider_kyc_status: bridgeStatus" in status and "bridge_provider_kyb_status" in profile,
    "existing retry fetches ToS": "/tos_acceptance_link`" in kyb,
    "existing retry fetches current KYB": "/kyc_link?${params.toString()}`" in kyb,
    "terms phase never returns KYB": 'link_url: phase === "terms" ? null : clientLinkUrl' in kyb,
    "accepted terms are explicit": "tos_accepted: true" in kyb,
    "KYB phase waits for provider acceptance": 'phase === "kyb" && termsAccepted' in kyb,
    "all nonterminal existing businesses require ToS first": "requiresTermsFirst" in kyb and "mandatory ToS URL missing" in kyb,
    "paused rejected offboarded cannot restart": "terminalBusinessVerification" in kyb and "verification_not_restartable" in kyb,
    "verification screen prioritizes ToS": screen.find("if (r?.success && r.data?.tos_link_url)") < screen.find("if (r?.success && r.data?.link_url)"),
    "ToS CTA prioritizes external KYB": screen.find("const continueFromEmbeddedTos") < screen.find("if (r?.success && r.data?.link_url)", screen.find("const continueFromEmbeddedTos")) < screen.find("if (r?.success && r.data?.tos_link_url)", screen.find("const continueFromEmbeddedTos")),
    "approved remains terminal": "already_approved: true" in kyb,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("FAIL: " + "; ".join(failed))
print(f"PASS: {len(checks)}/{len(checks)} business KYB ToS restart checks")

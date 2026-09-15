#!/usr/bin/env python3
"""Fail closed if the hosted business-verification payload drifts."""

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "supabase/functions/bridge-kyb-link/index.ts").read_text(encoding="utf-8")
PROVIDER = (ROOT / "supabase/functions/_shared/providers/bridge.ts").read_text(encoding="utf-8")
UPGRADE = (ROOT / "supabase/functions/subscription-upgrade/index.ts").read_text(encoding="utf-8")


def main() -> int:
    request_body = re.search(
        r"const reqBody: Record<string, unknown> = \{(?P<body>.*?)\n\s*\};",
        SOURCE,
        re.DOTALL,
    )
    body = request_body.group("body") if request_body else ""
    provider_start = PROVIDER.find("async createKycLink(")
    provider_end = PROVIDER.find("// ── Virtual accounts", provider_start)
    provider_body = PROVIDER[provider_start:provider_end] if provider_start >= 0 and provider_end > provider_start else ""
    checks = {
        "business type is explicit": re.search(r'type:\s*"business"', body) is not None,
        "verified profile email is sent": re.search(r"email:\s*profile\.email", body) is not None,
        "legal entity name uses hosted-link full_name": re.search(r"full_name:\s*biz\.company_name", body) is not None,
        "obsolete business_legal_name is absent": "business_legal_name" not in body,
        "shared KYC-link provider uses full_name": "body.full_name = input.company_name" in provider_body,
        "shared KYC-link provider omits obsolete field": "body.business_legal_name" not in provider_body,
        "subscription verification link uses full_name": "full_name: biz.company_name" in UPGRADE,
        "subscription verification link omits obsolete field": "business_legal_name: biz.company_name" not in UPGRADE,
        "direct KYB link rotates cached invalid requests": 'KYB_LINK_CONTRACT_VERSION = "full-name-v2"' in SOURCE,
        "direct creation key uses contract version": "${KYB_LINK_CONTRACT_VERSION}:${user.id}" in SOURCE,
        "shared provider key uses contract version": "${KYC_LINK_CONTRACT_VERSION}:${input.account_type}" in provider_body,
        "subscription fallback key uses contract version": "business:full-name-v2" in UPGRADE,
        "redirect URI remains application callback": "redirect_uri:" in body and "APP_URL" in body,
        "existing customer resumes through customer KYB endpoint": (
            "const encodedCustomerId = encodeURIComponent(existingCustomerId)" in SOURCE
            and "/v0/customers/${encodedCustomerId}/kyc_link" in SOURCE
        ),
        "stored link is refreshed before creating another": "/v0/kyc_links/${encodeURIComponent(biz.bridge_kyb_link_id)}" in SOURCE,
        "new-customer payload does not send customer_id": "customer_id" not in body,
        "new customer creation remains server-side": 'bridgePost(\n      "/v0/kyc_links"' in SOURCE,
        "backend extracts the hosted Terms URL": "tos_link_url ||= c?.tos_link?.url" in SOURCE,
        "backend returns Terms before identity verification": "tos_link_url: tosRequired ? link.tos_link_url : null" in SOURCE,
        "Terms state recognizes approved and accepted status": 'tosStatus !== "approved" && tosStatus !== "accepted"' in SOURCE,
    }
    failed = [name for name, passed in checks.items() if not passed]
    for name, passed in checks.items():
        print(f"[{'PASS' if passed else 'FAIL'}] {name}")
    print(f"Bridge KYB-link payload audit: {len(checks) - len(failed)}/{len(checks)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

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
        r"const reqBody: Record<string, unknown> = \{(?P<body>.*?)\n  \};",
        SOURCE,
        re.DOTALL,
    )
    body = request_body.group("body") if request_body else ""
    provider_start = PROVIDER.find("async createKycLink(")
    provider_end = PROVIDER.find("// ── Virtual accounts", provider_start)
    provider_body = PROVIDER[provider_start:provider_end] if provider_start >= 0 and provider_end > provider_start else ""
    checks = {
        "business type is explicit": 'type:                 "business"' in body,
        "verified profile email is sent": "email:                profile.email" in body,
        "legal entity name uses hosted-link full_name": "full_name:             biz.company_name" in body,
        "obsolete business_legal_name is absent": "business_legal_name" not in body,
        "shared KYC-link provider uses full_name": "body.full_name = input.company_name" in provider_body,
        "shared KYC-link provider omits obsolete field": "body.business_legal_name" not in provider_body,
        "subscription verification link uses full_name": "full_name: biz.company_name" in UPGRADE,
        "subscription verification link omits obsolete field": "business_legal_name: biz.company_name" not in UPGRADE,
        "redirect URI remains HTTPS application callback": "redirect_uri:" in body and "APP_URL" in body,
        "stale customer id has a no-id retry": "delete fallbackBody.customer_id" in SOURCE,
        "provider validation remains server-side": 'bridgePost(\n    "/v0/kyc_links"' in SOURCE,
    }
    failed = [name for name, passed in checks.items() if not passed]
    for name, passed in checks.items():
        print(f"[{'PASS' if passed else 'FAIL'}] {name}")
    print(f"Bridge KYB-link payload audit: {len(checks) - len(failed)}/{len(checks)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

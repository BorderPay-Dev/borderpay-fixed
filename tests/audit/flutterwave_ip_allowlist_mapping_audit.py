#!/usr/bin/env python3
"""
Step 11 audit: map upstream Flutterwave IP whitelist errors to static_ip_not_ready.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]

CHECKS = [
    (
        "supabase/functions/_shared/providers/flutterwave-client.ts",
        "flutterwave_ip_not_allowlisted",
        "client normalizes IP allowlist error",
    ),
    (
        "supabase/functions/flutterwave-transfer-create/index.ts",
        "res.error === \"flutterwave_ip_not_allowlisted\"",
        "transfer-create detects normalized IP allowlist error",
    ),
    (
        "supabase/functions/flutterwave-transfer-create/index.ts",
        "code: isIpGuard ? \"static_ip_not_ready\" : \"upstream_error\"",
        "transfer-create maps to static_ip_not_ready response code",
    ),
    (
        "supabase/functions/flutterwave-transfer-rates/index.ts",
        "code: isIpGuard ? \"static_ip_not_ready\" : \"upstream_error\"",
        "transfer-rates maps to static_ip_not_ready response code",
    ),
    (
        "supabase/functions/flutterwave-account-resolve/index.ts",
        "code: isIpGuard ? \"static_ip_not_ready\" : \"upstream_error\"",
        "account-resolve maps to static_ip_not_ready response code",
    ),
    (
        "supabase/functions/flutterwave-transfer-status/index.ts",
        "code: isIpGuard ? \"static_ip_not_ready\" : \"upstream_error\"",
        "transfer-status maps to static_ip_not_ready response code",
    ),
    (
        "supabase/functions/flutterwave-collection-create/index.ts",
        "code: isIpGuard ? \"static_ip_not_ready\" : \"upstream_error\"",
        "collection-create maps to static_ip_not_ready response code",
    ),
    (
        "supabase/functions/flutterwave-collection-status/index.ts",
        "code: isIpGuard ? \"static_ip_not_ready\" : \"upstream_error\"",
        "collection-status maps to static_ip_not_ready response code",
    ),
]


def main() -> int:
    failures = []
    for rel, token, label in CHECKS:
        p = ROOT / rel
        if not p.exists():
            failures.append(f"missing file: {rel}")
            continue
        text = p.read_text(encoding="utf-8")
        if token not in text:
            failures.append(f"{label} missing token '{token}' in {rel}")
        else:
            print(f"[OK] {rel}: {label}")

    if failures:
        print("flutterwave_ip_allowlist_mapping_audit: FAIL")
        for item in failures:
            print(f" - {item}")
        return 1

    print("flutterwave_ip_allowlist_mapping_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

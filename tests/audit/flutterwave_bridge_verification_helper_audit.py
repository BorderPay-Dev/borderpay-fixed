#!/usr/bin/env python3
"""
Step 17 audit: centralized Bridge verification helper is used across Flutterwave endpoints.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]

CHECKS = [
    (
        "supabase/functions/_shared/providers/provider-corridor-policy.ts",
        "export function isBridgeProfileVerified(profile: any): boolean",
        "shared bridge verification helper exported",
    ),
    (
        "supabase/functions/flutterwave-transfer-create/index.ts",
        "isBridgeProfileVerified(profile)",
        "transfer-create uses shared helper",
    ),
    (
        "supabase/functions/flutterwave-transfer-rates/index.ts",
        "isBridgeProfileVerified(profile)",
        "transfer-rates uses shared helper",
    ),
    (
        "supabase/functions/flutterwave-account-resolve/index.ts",
        "isBridgeProfileVerified(profile)",
        "account-resolve uses shared helper",
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
        print("flutterwave_bridge_verification_helper_audit: FAIL")
        for item in failures:
            print(f" - {item}")
        return 1

    print("flutterwave_bridge_verification_helper_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())


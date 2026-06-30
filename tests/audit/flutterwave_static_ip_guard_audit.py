#!/usr/bin/env python3
"""
Step 6 audit: static egress IP guard for Flutterwave money movement.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]

CHECKS = [
    (
        "supabase/functions/_shared/providers/flutterwave.ts",
        "FLW_STATIC_IP_REQUIRED",
        "static IP requirement env exists",
    ),
    (
        "supabase/functions/_shared/providers/flutterwave.ts",
        "FLW_STATIC_IP_READY",
        "static IP readiness env exists",
    ),
    (
        "supabase/functions/_shared/providers/flutterwave.ts",
        "getFlutterwaveNetworkGuard",
        "network guard helper exported",
    ),
    (
        "supabase/functions/flutterwave-transfer-create/index.ts",
        "getFlutterwaveNetworkGuard(\"money_movement\")",
        "transfer create enforces money movement network guard",
    ),
    (
        "supabase/functions/_shared/providers/flutterwave.ts",
        "static_ip_not_ready",
        "network guard exposes static ip not ready code",
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
        print("flutterwave_static_ip_guard_audit: FAIL")
        for item in failures:
            print(f" - {item}")
        return 1

    print("flutterwave_static_ip_guard_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Step 3 audit: policy coverage for Flutterwave preflight endpoints.
Ensures corridor policy gate is enforced on:
  - flutterwave-transfer-create
  - flutterwave-transfer-rates
  - flutterwave-account-resolve
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]

CHECKS = [
    (
        "supabase/functions/flutterwave-transfer-create/index.ts",
        "evaluateProviderCorridorPolicy",
        "transfer-create corridor gate",
    ),
    (
        "supabase/functions/flutterwave-transfer-rates/index.ts",
        "evaluateProviderCorridorPolicy",
        "transfer-rates corridor gate",
    ),
    (
        "supabase/functions/flutterwave-account-resolve/index.ts",
        "evaluateProviderCorridorPolicy",
        "account-resolve corridor gate",
    ),
    (
        "supabase/functions/flutterwave-transfer-rates/index.ts",
        "destination_country is required",
        "transfer-rates destination country validation",
    ),
    (
        "supabase/functions/flutterwave-account-resolve/index.ts",
        "destination_country",
        "account-resolve destination country wiring",
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
        print("flutterwave_policy_coverage_audit: FAIL")
        for item in failures:
            print(f" - {item}")
        return 1

    print("flutterwave_policy_coverage_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())


#!/usr/bin/env python3
"""
Step 8 audit: prevent hardcoded Flutterwave corridor assumptions.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "supabase/functions/_shared/payouts/corridor-router.ts"


def main() -> int:
    if not TARGET.exists():
        print("flutterwave_no_hardcoded_corridors_audit: FAIL")
        print(" - missing file: supabase/functions/_shared/payouts/corridor-router.ts")
        return 1

    text = TARGET.read_text(encoding="utf-8")
    failures = []

    if "provider_corridor_policy" not in text:
        failures.append("missing provider_corridor_policy policy-source comment in corridor-router")
    if "return false;" not in text:
        failures.append("legacy flutterwave helper is not fail-closed")
    for token in ("FLW_SUPPORTED_COUNTRIES", "FLW_SUPPORTED_CURRENCIES", "NG\", \"KE\", \"GH"):
        if token in text:
            failures.append(f"hardcoded Flutterwave corridor token still present: {token}")

    if failures:
        print("flutterwave_no_hardcoded_corridors_audit: FAIL")
        for item in failures:
            print(f" - {item}")
        return 1

    print("[OK] corridor-router has no hardcoded Flutterwave country/currency sets")
    print("flutterwave_no_hardcoded_corridors_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())


#!/usr/bin/env python3
"""
Step 10 audit: capabilities endpoint requires auth.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "supabase/functions/flutterwave-capabilities/index.ts"
SHARED_AUTH = ROOT / "supabase/functions/_shared/african-rails-access.ts"


def main() -> int:
    if not TARGET.exists():
        print("flutterwave_capabilities_auth_audit: FAIL")
        print(" - missing file: supabase/functions/flutterwave-capabilities/index.ts")
        return 1

    text = TARGET.read_text(encoding="utf-8")
    shared = SHARED_AUTH.read_text(encoding="utf-8")
    required_tokens = [
        "Authorization required",
        "supabase.auth.getUser(token)",
        "Unauthorized",
    ]
    failures = [f"shared auth missing token '{token}'" for token in required_tokens if token not in shared]
    if "authenticateAfricanRailsTester" not in text:
        failures.append("capabilities endpoint does not enforce shared tester authentication")
    if failures:
        print("flutterwave_capabilities_auth_audit: FAIL")
        for item in failures:
            print(f" - {item}")
        return 1

    print("[OK] flutterwave-capabilities enforces authenticated access")
    print("flutterwave_capabilities_auth_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

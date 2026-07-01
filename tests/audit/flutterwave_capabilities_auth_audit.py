#!/usr/bin/env python3
"""
Step 10 audit: capabilities endpoint requires auth.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "supabase/functions/flutterwave-capabilities/index.ts"


def main() -> int:
    if not TARGET.exists():
        print("flutterwave_capabilities_auth_audit: FAIL")
        print(" - missing file: supabase/functions/flutterwave-capabilities/index.ts")
        return 1

    text = TARGET.read_text(encoding="utf-8")
    required_tokens = [
        "Authorization required",
        "supa.auth.getUser(token)",
        "Unauthorized",
    ]
    failures = [f"missing token '{token}'" for token in required_tokens if token not in text]
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


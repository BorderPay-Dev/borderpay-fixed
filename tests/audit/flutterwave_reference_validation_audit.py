#!/usr/bin/env python3
"""
Step 13 audit: transfer reference validation hardening.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "supabase/functions/flutterwave-transfer-create/index.ts"


def main() -> int:
    if not TARGET.exists():
        print("flutterwave_reference_validation_audit: FAIL")
        print(" - missing file: supabase/functions/flutterwave-transfer-create/index.ts")
        return 1

    text = TARGET.read_text(encoding="utf-8")
    checks = [
        "function validReference(value: string): boolean",
        "^[A-Za-z0-9._:-]{6,120}$",
        "reference must be 6-120 chars",
    ]
    missing = [c for c in checks if c not in text]
    if missing:
        print("flutterwave_reference_validation_audit: FAIL")
        for item in missing:
            print(f" - missing token: {item}")
        return 1

    print("[OK] flutterwave-transfer-create validates reference format and length")
    print("flutterwave_reference_validation_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())


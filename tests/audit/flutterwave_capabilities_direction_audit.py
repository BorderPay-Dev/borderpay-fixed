#!/usr/bin/env python3
"""
Ensure flutterwave-capabilities supports direction-aware corridor policy.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "supabase/functions/flutterwave-capabilities/index.ts"


def main() -> int:
    if not TARGET.exists():
        print("flutterwave_capabilities_direction_audit: FAIL")
        print(" - missing file: supabase/functions/flutterwave-capabilities/index.ts")
        return 1

    text = TARGET.read_text(encoding="utf-8")
    checks = [
      "type Direction = \"payout\" | \"receive\";",
      "function parseDirection(",
      "direction must be payout or receive",
      "direction,",
    ]
    missing = [c for c in checks if c not in text]
    if missing:
        print("flutterwave_capabilities_direction_audit: FAIL")
        for item in missing:
            print(f" - missing token: {item}")
        return 1

    print("[OK] flutterwave-capabilities is direction-aware for payout/receive corridor policy")
    print("flutterwave_capabilities_direction_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

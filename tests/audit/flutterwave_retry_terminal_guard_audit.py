#!/usr/bin/env python3
"""
Step 15 audit: retry guard for terminal transfer states.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "supabase/functions/flutterwave-transfer-create/index.ts"


def main() -> int:
    if not TARGET.exists():
        print("flutterwave_retry_terminal_guard_audit: FAIL")
        print(" - missing file: supabase/functions/flutterwave-transfer-create/index.ts")
        return 1

    text = TARGET.read_text(encoding="utf-8")
    checks = [
        'code: "retry_not_allowed_terminal_state"',
        'if (localStatus === "completed" || localStatus === "reversed")',
        ".eq(\"provider_transfer_id\", providerTransferId)",
    ]
    missing = [c for c in checks if c not in text]
    if missing:
        print("flutterwave_retry_terminal_guard_audit: FAIL")
        for item in missing:
            print(f" - missing token: {item}")
        return 1

    print("[OK] retry path blocks terminal transfer states")
    print("flutterwave_retry_terminal_guard_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())


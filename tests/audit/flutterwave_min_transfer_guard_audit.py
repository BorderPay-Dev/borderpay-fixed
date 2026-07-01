#!/usr/bin/env python3
"""
Step 18 audit: minimum transfer amount guard.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]

CHECKS = [
    (
        "supabase/functions/flutterwave-transfer-create/index.ts",
        "FLW_MIN_TRANSFER_AMOUNT",
        "transfer-create reads min transfer env",
    ),
    (
        "supabase/functions/flutterwave-transfer-create/index.ts",
        "code: \"amount_below_minimum\"",
        "transfer-create returns minimum-amount guard code",
    ),
    (
        ".env.example",
        "FLW_MIN_TRANSFER_AMOUNT=",
        "env example documents min transfer amount",
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
        print("flutterwave_min_transfer_guard_audit: FAIL")
        for item in failures:
            print(f" - {item}")
        return 1

    print("flutterwave_min_transfer_guard_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())


#!/usr/bin/env python3
"""
Ensure Flutterwave collection-create enforces env-driven minimum amount guard.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "supabase/functions/flutterwave-collection-create/index.ts"
ENV_EXAMPLE = ROOT / ".env.example"


def main() -> int:
    failures: list[str] = []
    if not TARGET.exists():
        failures.append("missing file: supabase/functions/flutterwave-collection-create/index.ts")
    if not ENV_EXAMPLE.exists():
        failures.append("missing file: .env.example")
    if failures:
        print("flutterwave_min_collection_guard_audit: FAIL")
        for f in failures:
            print(f" - {f}")
        return 1

    text = TARGET.read_text(encoding="utf-8")
    env = ENV_EXAMPLE.read_text(encoding="utf-8")
    checks = [
        ("collection-create reads min collection env", "FLW_MIN_COLLECTION_AMOUNT"),
        ("collection-create emits amount_below_minimum", "amount_below_minimum"),
        ("collection-create minimum error message present", "Minimum collection amount is"),
    ]
    for label, token in checks:
        if token not in text:
            failures.append(f"{label}: missing token '{token}'")
        else:
            print(f"[OK] {label}")

    if "FLW_MIN_COLLECTION_AMOUNT=" not in env:
        failures.append(".env.example missing FLW_MIN_COLLECTION_AMOUNT")
    else:
        print("[OK] env example documents min collection amount")

    if failures:
        print("flutterwave_min_collection_guard_audit: FAIL")
        for f in failures:
            print(f" - {f}")
        return 1

    print("flutterwave_min_collection_guard_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())


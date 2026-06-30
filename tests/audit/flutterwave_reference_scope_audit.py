#!/usr/bin/env python3
"""
Step 9 audit: Flutterwave reference idempotency is user-scoped.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]

CHECKS = [
    (
        "supabase/migrations/20260630201000_flutterwave_reference_scope_user.sql",
        "drop index if exists public.flw_transfers_reference_uq;",
        "drops global reference unique index",
    ),
    (
        "supabase/migrations/20260630201000_flutterwave_reference_scope_user.sql",
        "create unique index if not exists flw_transfers_user_reference_uq",
        "creates user+reference unique index",
    ),
    (
        "supabase/functions/flutterwave-transfer-create/index.ts",
        'onConflict: "user_id,reference"',
        "transfer-create upsert uses user-scoped conflict target",
    ),
    (
        "supabase/functions/flutterwave-webhook/index.ts",
        'onConflict: "user_id,reference"',
        "webhook seed upsert uses user-scoped conflict target",
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
        print("flutterwave_reference_scope_audit: FAIL")
        for item in failures:
            print(f" - {item}")
        return 1

    print("flutterwave_reference_scope_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())


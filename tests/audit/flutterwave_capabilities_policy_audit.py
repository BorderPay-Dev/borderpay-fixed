#!/usr/bin/env python3
"""
Step 4 audit: ensure capabilities + momo directory are corridor-policy gated.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]

CHECKS = [
    (
        "supabase/functions/flutterwave-capabilities/index.ts",
        "isProviderCorridorEnabled",
        "capabilities uses corridor gate",
    ),
    (
        "supabase/functions/flutterwave-capabilities/index.ts",
        "listProviderCorridors",
        "capabilities loads DB corridor rows",
    ),
    (
        "supabase/functions/get-momo-providers/index.ts",
        "isProviderCorridorEnabled",
        "momo provider list is corridor-gated",
    ),
    (
        "supabase/functions/_shared/providers/provider-corridor-policy.ts",
        "export async function isProviderCorridorEnabled",
        "shared corridor enabled helper exported",
    ),
    (
        "supabase/functions/_shared/providers/provider-corridor-policy.ts",
        "export async function listProviderCorridors",
        "shared corridor list helper exported",
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
        print("flutterwave_capabilities_policy_audit: FAIL")
        for item in failures:
            print(f" - {item}")
        return 1

    print("flutterwave_capabilities_policy_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())


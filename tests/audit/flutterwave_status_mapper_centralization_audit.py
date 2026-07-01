#!/usr/bin/env python3
"""
Ensure Flutterwave status mapping is centralized in shared provider adapter.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    shared = ROOT / "supabase/functions/_shared/providers/flutterwave.ts"
    if not shared.exists():
        print("flutterwave_status_mapper_centralization_audit: FAIL")
        print(" - missing shared provider file")
        return 1

    shared_text = shared.read_text(encoding="utf-8")
    if "export function mapFlutterwaveProviderStatus(" not in shared_text:
        print("flutterwave_status_mapper_centralization_audit: FAIL")
        print(" - missing mapFlutterwaveProviderStatus export in shared provider")
        return 1

    targets = [
        "supabase/functions/flutterwave-transfer-create/index.ts",
        "supabase/functions/flutterwave-transfer-status/index.ts",
        "supabase/functions/flutterwave-collection-create/index.ts",
        "supabase/functions/flutterwave-collection-status/index.ts",
        "supabase/functions/flutterwave-webhook/index.ts",
    ]

    failures: list[str] = []
    for rel in targets:
        p = ROOT / rel
        if not p.exists():
            failures.append(f"missing file: {rel}")
            continue
        text = p.read_text(encoding="utf-8")
        if "mapFlutterwaveProviderStatus" not in text:
            failures.append(f"{rel}: missing mapFlutterwaveProviderStatus usage")
        if "function mapTransferState(" in text or "function mapCollectionState(" in text:
            failures.append(f"{rel}: still defines local status mapper")

    if failures:
        print("flutterwave_status_mapper_centralization_audit: FAIL")
        for f in failures:
            print(f" - {f}")
        return 1

    print("[OK] status mapping centralized via mapFlutterwaveProviderStatus")
    print("flutterwave_status_mapper_centralization_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())


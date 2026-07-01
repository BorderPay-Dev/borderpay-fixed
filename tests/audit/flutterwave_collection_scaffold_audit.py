#!/usr/bin/env python3
"""
Flutterwave collection scaffold audit.

Ensures backend-only collection flows exist and are policy-gated:
- flutterwave-collection-create
- flutterwave-collection-status
- adapter charge methods
- config JWT pins
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def require(path: str, pattern: str, label: str, failures: list[str]) -> None:
    text = read(path)
    if not re.search(pattern, text, re.MULTILINE):
        failures.append(f"{path}: missing {label}")
    else:
        print(f"[OK] {path}: {label}")


def main() -> int:
    failures: list[str] = []

    files = [
        "supabase/functions/flutterwave-collection-create/index.ts",
        "supabase/functions/flutterwave-collection-status/index.ts",
        "supabase/functions/_shared/providers/flutterwave.ts",
        "supabase/config.toml",
    ]
    for f in files:
        if not (ROOT / f).is_file():
            failures.append(f"missing file: {f}")
        else:
            print(f"[OK] present: {f}")

    if failures:
        print("flutterwave_collection_scaffold_audit: FAIL")
        for f in failures:
            print(f" - {f}")
        return 1

    require(
        "supabase/functions/_shared/providers/flutterwave.ts",
        r"export async function flutterwaveCreateCharge\(",
        "adapter exposes flutterwaveCreateCharge",
        failures,
    )
    require(
        "supabase/functions/_shared/providers/flutterwave.ts",
        r"export async function flutterwaveGetCharge\(",
        "adapter exposes flutterwaveGetCharge",
        failures,
    )
    require(
        "supabase/functions/flutterwave-collection-create/index.ts",
        r"evaluateProviderCorridorPolicy\(",
        "collection-create applies corridor policy",
        failures,
    )
    require(
        "supabase/functions/flutterwave-collection-create/index.ts",
        r"direction:\s*\"receive\"",
        "collection-create enforces receive direction policy",
        failures,
    )
    require(
        "supabase/functions/flutterwave-collection-create/index.ts",
        r"getFlutterwaveNetworkGuard\(\"money_movement\"\)",
        "collection-create enforces static IP money movement guard",
        failures,
    )
    require(
        "supabase/functions/flutterwave-collection-create/index.ts",
        r"flutterwaveCreateCharge\(",
        "collection-create calls adapter",
        failures,
    )
    require(
        "supabase/functions/flutterwave-collection-status/index.ts",
        r"flutterwaveGetCharge\(",
        "collection-status calls adapter",
        failures,
    )
    require(
        "supabase/functions/flutterwave-collection-status/index.ts",
        r"direction:\s*row\.direction\s*\|\|\s*\"receive\"",
        "collection-status returns explicit direction in response",
        failures,
    )
    require(
        "supabase/functions/flutterwave-collection-status/index.ts",
        r"source:\s*row\.source\s*\|\|\s*\"flutterwave\"",
        "collection-status returns explicit source in response",
        failures,
    )
    require(
        "supabase/functions/flutterwave-collection-status/index.ts",
        r"capabilities:\s*caps",
        "collection-status returns capabilities in response",
        failures,
    )
    require(
        "supabase/functions/flutterwave-collection-status/index.ts",
        r"getFlutterwaveNetworkGuard\(\"read\"\)",
        "collection-status uses read-scope network guard",
        failures,
    )
    require(
        "supabase/config.toml",
        r"\[functions\.flutterwave-collection-create\]\s*verify_jwt\s*=\s*true",
        "config pins collection-create verify_jwt=true",
        failures,
    )
    require(
        "supabase/config.toml",
        r"\[functions\.flutterwave-collection-status\]\s*verify_jwt\s*=\s*true",
        "config pins collection-status verify_jwt=true",
        failures,
    )

    if failures:
        print("flutterwave_collection_scaffold_audit: FAIL")
        for f in failures:
            print(f" - {f}")
        return 1

    print("flutterwave_collection_scaffold_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

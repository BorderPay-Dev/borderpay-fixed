#!/usr/bin/env python3
"""
Lock transfer-status direction validation/capability gating contract.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "supabase/functions/flutterwave-transfer-status/index.ts"


def fail(msg: str) -> int:
    print("flutterwave_transfer_status_direction_audit: FAIL")
    print(f" - {msg}")
    return 1


def main() -> int:
    if not TARGET.exists():
        return fail("missing file: supabase/functions/flutterwave-transfer-status/index.ts")

    text = TARGET.read_text(encoding="utf-8")
    required = [
        ("direction allowlist", "ALLOWED_DIRECTION"),
        ("direction validation message", "direction must be payout or receive"),
        ("payout capability guard code", "Flutterwave payout rails are not enabled in this environment."),
        ("receive capability guard code", "Flutterwave receive rails are not enabled in this environment."),
        ("direction filter on local record query", '.eq("direction", direction)'),
        ("endpoint marker", 'endpoint: "flutterwave-transfer-status"'),
        ("status scope marker", 'status_scope: "transfer"'),
        ("response contract version marker", "response_contract_version: 1"),
        ("provider marker", 'provider: "flutterwave"'),
        ("direction echoed in response payload", "direction: localRecord.direction || null"),
        ("source echoed in response payload", 'source: localRecord.source || "flutterwave"'),
        ("provider status echoed in response payload", "provider_status: providerStatus"),
    ]
    missing = [label for label, token in required if token not in text]
    if missing:
        return fail("missing tokens: " + ", ".join(missing))

    print("[OK] transfer-status direction validation + capability gating present")
    print("flutterwave_transfer_status_direction_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

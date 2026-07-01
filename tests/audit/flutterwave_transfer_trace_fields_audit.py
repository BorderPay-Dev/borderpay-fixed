#!/usr/bin/env python3
"""
Step 12 audit: Flutterwave transfer traceability fields are persisted.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]

CHECKS = [
    (
        "supabase/migrations/20260630203000_flutterwave_transfer_trace_fields.sql",
        "provider_request_id",
        "migration adds provider_request_id",
    ),
    (
        "supabase/migrations/20260630203000_flutterwave_transfer_trace_fields.sql",
        "provider_http_status",
        "migration adds provider_http_status",
    ),
    (
        "supabase/functions/flutterwave-transfer-create/index.ts",
        "provider_request_id: res.requestId || null",
        "transfer-create persists provider request id",
    ),
    (
        "supabase/functions/flutterwave-transfer-status/index.ts",
        "provider_request_id: res.requestId || null",
        "transfer-status persists provider request id",
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
        print("flutterwave_transfer_trace_fields_audit: FAIL")
        for item in failures:
            print(f" - {item}")
        return 1

    print("flutterwave_transfer_trace_fields_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())


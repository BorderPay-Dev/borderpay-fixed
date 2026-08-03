#!/usr/bin/env python3
"""
Step 5 audit: webhook hardening checks.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]

CHECKS = [
    (
        "supabase/functions/_shared/providers/flutterwave.ts",
        "FLW_WEBHOOK_SECRET",
        "supports alternate webhook secret env",
    ),
    (
        "supabase/functions/_shared/providers/flutterwave.ts",
        "Constant-time compare",
        "contains constant-time signature compare block",
    ),
    (
        "supabase/functions/_shared/providers/flutterwave.ts",
        'crypto.subtle.sign("HMAC"',
        "verifies V4 HMAC-SHA256 raw-body signature",
    ),
    (
        "supabase/functions/flutterwave-webhook/index.ts",
        "hash:${payloadHash.slice(0, 32)}",
        "event id falls back to payload hash when missing",
    ),
    (
        "supabase/functions/flutterwave-webhook/index.ts",
        "signature_ok: true",
        "duplicate path preserves signature_ok",
    ),
    (
        "supabase/functions/flutterwave-webhook/index.ts",
        '"flutterwave-signature-present": true',
        "persists signature presence without storing replayable signature material",
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
        print("flutterwave_webhook_hardening_audit: FAIL")
        for item in failures:
            print(f" - {item}")
        return 1

    print("flutterwave_webhook_hardening_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

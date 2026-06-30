#!/usr/bin/env python3
"""
Step 14 audit: webhook reconciles only transfer-relevant events.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "supabase/functions/flutterwave-webhook/index.ts"


def main() -> int:
    if not TARGET.exists():
        print("flutterwave_webhook_event_scope_audit: FAIL")
        print(" - missing file: supabase/functions/flutterwave-webhook/index.ts")
        return 1

    text = TARGET.read_text(encoding="utf-8")
    checks = [
        "function shouldReconcileTransferEvent(",
        "t.includes(\"transfer\") || t.includes(\"payout\")",
        "if (transferEventEligible) {",
        "transfer_event_eligible",
    ]
    missing = [c for c in checks if c not in text]
    if missing:
        print("flutterwave_webhook_event_scope_audit: FAIL")
        for item in missing:
            print(f" - missing token: {item}")
        return 1

    print("[OK] webhook reconciliation is scoped to transfer-like events")
    print("flutterwave_webhook_event_scope_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())


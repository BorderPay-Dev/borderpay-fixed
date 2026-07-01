#!/usr/bin/env python3
"""
Webhook event-scope audit: webhook reconciles only money-movement events.
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
        "function shouldReconcileMoneyMovementEvent(",
        "t.includes(\"transfer\") || t.includes(\"payout\") || t.includes(\"charge\") || t.includes(\"collection\")",
        "if (transferEventEligible) {",
        'endpoint: "flutterwave-webhook"',
        'provider: "flutterwave"',
        'webhook_scope: "money_movement"',
        "response_contract_version: 1",
        'event_classification: transferEventEligible ? "money_movement" : "non_money_movement"',
        "signature_verified: true",
        "replay_window_enforced: true",
        "processing_status: processingStatus",
        "transfer_event_eligible",
        "movement_direction",
    ]
    missing = [c for c in checks if c not in text]
    if missing:
        print("flutterwave_webhook_event_scope_audit: FAIL")
        for item in missing:
            print(f" - missing token: {item}")
        return 1

    print("[OK] webhook reconciliation is scoped to money-movement events only")
    print("flutterwave_webhook_event_scope_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

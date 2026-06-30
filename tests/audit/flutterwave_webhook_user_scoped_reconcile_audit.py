#!/usr/bin/env python3
"""
Step 16 audit: webhook reference reconciliation must be user-scoped.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "supabase/functions/flutterwave-webhook/index.ts"


def main() -> int:
    if not TARGET.exists():
        print("flutterwave_webhook_user_scoped_reconcile_audit: FAIL")
        print(" - missing file: supabase/functions/flutterwave-webhook/index.ts")
        return 1

    text = TARGET.read_text(encoding="utf-8")
    checks = [
        '.eq("provider_transfer_id", transfer.providerTransferId)',
        'if (!reconciled && transfer.reference && isUuid(transfer.userIdFromMeta))',
        '.eq("user_id", transfer.userIdFromMeta)',
        '.eq("reference", transfer.reference)',
        'insufficient_identity_for_reference_reconcile',
    ]
    missing = [c for c in checks if c not in text]
    if missing:
        print("flutterwave_webhook_user_scoped_reconcile_audit: FAIL")
        for item in missing:
            print(f" - missing token: {item}")
        return 1

    print("[OK] webhook reference reconciliation is user-scoped and fail-safe")
    print("flutterwave_webhook_user_scoped_reconcile_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())


#!/usr/bin/env python3
"""
Lock flutterwave-transfer-create retry success response contract fields.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "supabase/functions/flutterwave-transfer-create/index.ts"


def fail(msg: str) -> int:
    print("flutterwave_transfer_retry_response_contract_audit: FAIL")
    print(f" - {msg}")
    return 1


def main() -> int:
    if not TARGET.exists():
        return fail("missing file: supabase/functions/flutterwave-transfer-create/index.ts")

    text = TARGET.read_text(encoding="utf-8")
    marker = "return json({\n      success: true,\n      data: {\n        mode: \"retry\","
    start = text.find(marker)
    if start < 0:
        return fail("retry success response block not found")
    end = text.find("\n    });", start)
    if end < 0:
        return fail("retry success response closing block not found")
    block = text[start:end]

    required = [
        'create_scope: "transfer_retry"',
        "response_contract_version: 1",
        'provider: "flutterwave"',
        'direction: "payout"',
        'source: "flutterwave"',
        "transfer_id: providerTransferId,",
        "status: mappedStatus,",
    ]
    missing = [token for token in required if token not in block]
    if missing:
        return fail("missing retry response contract tokens: " + ", ".join(missing))

    print("[OK] transfer-create retry success response includes explicit provider/direction/source contract")
    print("flutterwave_transfer_retry_response_contract_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

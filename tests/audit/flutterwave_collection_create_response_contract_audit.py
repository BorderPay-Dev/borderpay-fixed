#!/usr/bin/env python3
"""
Lock flutterwave-collection-create success response contract fields.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "supabase/functions/flutterwave-collection-create/index.ts"


def fail(msg: str) -> int:
    print("flutterwave_collection_create_response_contract_audit: FAIL")
    print(f" - {msg}")
    return 1


def main() -> int:
    if not TARGET.exists():
        return fail("missing file: supabase/functions/flutterwave-collection-create/index.ts")

    text = TARGET.read_text(encoding="utf-8")
    marker = "return json({\n    success: true,\n    data: {\n      mode: \"collection_create\","
    start = text.find(marker)
    if start < 0:
        return fail("collection create success response block not found")
    end = text.find("\n  });", start)
    if end < 0:
        return fail("collection create success response closing block not found")
    block = text[start:end]

    required = [
        'provider: "flutterwave"',
        'direction: "receive"',
        'source: "flutterwave"',
        "reference,",
        "provider_transfer_id: providerId,",
        "status: mappedStatus,",
    ]
    missing = [token for token in required if token not in block]
    if missing:
        return fail("missing collection create response contract tokens: " + ", ".join(missing))

    print("[OK] collection-create success response includes explicit provider/direction/source contract")
    print("flutterwave_collection_create_response_contract_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

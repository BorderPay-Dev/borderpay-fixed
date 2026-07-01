#!/usr/bin/env python3
"""
Ensure retry path persists provider trace fields on both failure and success updates.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "supabase/functions/flutterwave-transfer-create/index.ts"


def fail(msg: str) -> int:
    print("flutterwave_retry_trace_fields_audit: FAIL")
    print(f" - {msg}")
    return 1


def main() -> int:
    if not TARGET.exists():
        return fail("missing file: supabase/functions/flutterwave-transfer-create/index.ts")

    text = TARGET.read_text(encoding="utf-8")
    start = text.find('if (mode === "retry") {')
    if start < 0:
        return fail('retry branch missing: if (mode === "retry") {')
    end = text.find("\n  const amount = toPositiveNumber", start)
    if end < 0:
        return fail("could not isolate retry branch boundary")
    branch = text[start:end]

    required = [
        "provider_request_id: res.requestId || null",
        "provider_http_status: Number.isFinite(res.status) ? res.status : null",
    ]
    missing = [token for token in required if token not in branch]
    if missing:
        return fail("missing retry trace tokens: " + ", ".join(missing))

    # Guard both retry DB updates (error+success) include trace fields.
    occurrences = branch.count("provider_request_id: res.requestId || null")
    if occurrences < 2:
        return fail("provider_request_id must be persisted in both retry updates")

    print("[OK] retry branch persists provider trace fields on failure and success")
    print("flutterwave_retry_trace_fields_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

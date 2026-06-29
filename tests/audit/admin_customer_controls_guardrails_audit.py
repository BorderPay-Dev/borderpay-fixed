#!/usr/bin/env python3
"""
Admin customer controls guardrail audit.

Ensures revoke actions remain fail-closed:
 - protected internal account deny
 - bridge_customer_id required for revoke actions
 - external account revoke action remains present
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "supabase" / "functions" / "admin-customer-controls" / "index.ts"


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    if not TARGET.is_file():
        fail(f"missing file: {TARGET}")
    txt = TARGET.read_text(encoding="utf-8")

    required_snippets = [
        "revoke_external_accounts",
        "protected_internal_account",
        "bridge_customer_required",
        "isProtectedInternalEmail",
        "dry_run",
    ]
    for s in required_snippets:
        if s not in txt:
            fail(f"missing guardrail snippet: {s}")

    print("admin_customer_controls_guardrails_audit:")
    print("  [OK] revoke_external_accounts action present")
    print("  [OK] protected internal account deny present")
    print("  [OK] bridge customer required deny present")
    print("  [OK] dry-run path present")
    print("PASS (4/4)")
    return 0


if __name__ == "__main__":
    sys.exit(main())


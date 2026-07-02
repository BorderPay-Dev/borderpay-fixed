#!/usr/bin/env python3
"""Fail CI if quarantined legacy endpoint aliases are reintroduced."""

from __future__ import annotations

import re
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
BACKEND_API = REPO / "utils" / "api" / "backendAPI.ts"

# Historical undeployed/drift endpoint aliases that must never be called.
BANNED_ALIASES = {
    "get-wallets",
    "get-transactions",
    "get-customer-transactions",
    "verify-transaction",
    "verify-transfer",
    "get-transfers",
    "get-institutions",
    "resolve-account",
    "check-account-status",
    "get-address",
    "send-email",
    "poa-upload-url",
    "export-transactions",
}


def main() -> int:
    text = BACKEND_API.read_text(encoding="utf-8")
    matches = re.findall(r"apiCall(?:<[^>]+>)?\(\s*'([^']+)'", text)
    active = sorted({name for name in matches if name in BANNED_ALIASES})

    if active:
        print("[legacy-endpoint-alias-guard] ERROR: banned endpoint aliases are still called:")
        for name in active:
            print(f"  - {name}")
        return 1

    print("[legacy-endpoint-alias-guard] OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


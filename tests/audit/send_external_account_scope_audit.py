#!/usr/bin/env python3
"""
Send / external-account runtime scope audit.

Fail closed if legacy external account types (clabe/pix) reappear in the
runtime send + app normalization path.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEND = ROOT / "components" / "send" / "SendMoneyFlow.tsx"
MAIN = ROOT / "components" / "app" / "MainApp.tsx"


def read(p: Path) -> str:
    if not p.is_file():
        print(f"FAIL: missing file: {p}", file=sys.stderr)
        sys.exit(1)
    return p.read_text(encoding="utf-8")


def must(cond: bool, msg: str) -> None:
    if not cond:
        print(f"FAIL: {msg}", file=sys.stderr)
        sys.exit(1)


def main() -> int:
    send = read(SEND)
    main = read(MAIN)

    # Runtime must not carry legacy account type branches.
    banned = re.compile(r"\b(clabe|pix)\b", re.IGNORECASE)
    must(not banned.search(send), "SendMoneyFlow contains legacy external account types (clabe/pix)")
    must(not banned.search(main), "MainApp external account prewarm/normalization contains legacy external account types (clabe/pix)")

    # Runtime rail mapping must remain us/iban only in send flow.
    must("'us' | 'iban'" in send, "SendMoneyFlow external account type union must be us|iban")
    must("account_type === 'iban' ? 'sepa'" in send, "SendMoneyFlow should map iban to sepa")

    print("send_external_account_scope_audit:")
    print("  [OK] no clabe/pix branches in runtime send/main normalization")
    print("  [OK] external account type union constrained to us/iban")
    print("PASS (2/2)")
    return 0


if __name__ == "__main__":
    sys.exit(main())


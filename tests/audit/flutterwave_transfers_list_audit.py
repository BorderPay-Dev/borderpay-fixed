#!/usr/bin/env python3
"""
Flutterwave transfers-list endpoint audit.
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "supabase/functions/flutterwave-transfers-list/index.ts"
CONFIG = ROOT / "supabase/config.toml"


def fail(msg: str) -> int:
    print("flutterwave_transfers_list_audit: FAIL")
    print(f" - {msg}")
    return 1


def main() -> int:
    if not TARGET.exists():
        return fail("missing file: supabase/functions/flutterwave-transfers-list/index.ts")
    if not CONFIG.exists():
        return fail("missing file: supabase/config.toml")

    text = TARGET.read_text(encoding="utf-8")
    cfg = CONFIG.read_text(encoding="utf-8")

    checks = [
        ("auth token required", "Authorization required"),
        ("jwt user lookup", ".auth.getUser(token)"),
        ("user ownership filter", '.eq("user_id", authData.user.id)'),
        ("direction filter whitelist", "ALLOWED_DIRECTION"),
        ("status filter whitelist", "ALLOWED_STATUS"),
        ("source filter whitelist", "ALLOWED_SOURCE"),
        ("source selected in response rows", '"source",'),
        ("limit clamp helper", "toPositiveInt("),
        ("cursor parser helper", "parseIsoTimestamp("),
        ("cursor filter", '.lt("created_at", before)'),
        ("flutterwave capability guard", "getFlutterwaveCapabilities"),
    ]
    missing = [label for (label, token) in checks if token not in text]
    if missing:
        print("flutterwave_transfers_list_audit: FAIL")
        for label in missing:
            print(f" - missing: {label}")
        return 1

    if not re.search(r"\[functions\.flutterwave-transfers-list\]\s*verify_jwt\s*=\s*true", cfg, re.MULTILINE):
        return fail("supabase/config.toml missing flutterwave-transfers-list verify_jwt=true pin")

    print("[OK] flutterwave-transfers-list endpoint enforces auth + ownership + bounded filters")
    print("flutterwave_transfers_list_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

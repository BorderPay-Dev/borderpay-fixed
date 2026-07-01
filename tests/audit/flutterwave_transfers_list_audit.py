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
        ("flutterwave source lock", '.eq("source", "flutterwave")'),
        ("direction filter whitelist", "ALLOWED_DIRECTION"),
        ("status filter whitelist", "ALLOWED_STATUS"),
        ("source filter whitelist", "ALLOWED_SOURCE"),
        ("channel filter whitelist", "ALLOWED_CHANNEL"),
        ("source selected in response rows", '"source",'),
        ("channel filter validation message", "channel must be bank or mobile_money"),
        ("payout capability guard", "Flutterwave payout rails are not enabled in this environment."),
        ("receive capability guard", "Flutterwave receive rails are not enabled in this environment."),
        ("both-rails disabled guard", "Flutterwave transfer list endpoint is not enabled in this environment."),
        ("implicit receive scoping", '.eq("direction", "receive")'),
        ("implicit payout scoping", '.eq("direction", "payout")'),
        ("effective direction variable", "let effectiveDirection"),
        ("direction echoed from effective value", "direction: effectiveDirection"),
        ("limit clamp helper", "toPositiveInt("),
        ("cursor parser helper", "parseIsoTimestamp("),
        ("cursor filter", '.lt("created_at", before)'),
        ("pagination has_more", "has_more: Boolean(nextBefore)"),
        ("pagination next_before", "next_before: nextBefore"),
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

    print("[OK] flutterwave-transfers-list endpoint enforces auth + ownership + flutterwave source scope + bounded filters")
    print("flutterwave_transfers_list_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

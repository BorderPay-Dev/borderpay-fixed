#!/usr/bin/env python3
"""
Ensure flutterwave-collections-list endpoint stays auth-bound and receive-scoped.
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "supabase/functions/flutterwave-collections-list/index.ts"
CFG = ROOT / "supabase/config.toml"


def fail(msg: str) -> int:
    print("flutterwave_collections_list_audit: FAIL")
    print(f" - {msg}")
    return 1


def main() -> int:
    if not TARGET.exists():
        return fail("missing file: supabase/functions/flutterwave-collections-list/index.ts")

    text = TARGET.read_text(encoding="utf-8")
    required = [
        ("auth required", "Authorization required"),
        ("auth user lookup", "supa.auth.getUser(token)"),
        ("ownership filter", '.eq("user_id", authData.user.id)'),
        ("receive direction lock", '.eq("direction", "receive")'),
        ("flutterwave source lock", '.eq("source", "flutterwave")'),
        ("direction selected in response rows", '"direction",'),
        ("source selected in response rows", '"source",'),
        ("endpoint marker", 'endpoint: "flutterwave-collections-list"'),
        ("list scope marker", 'list_scope: "collections"'),
        ("read scope marker", 'read_scope: "history"'),
        ("source scope marker", 'source_scope: "flutterwave_only"'),
        ("source lock marker", "filters_locked_to_source: true"),
        ("response contract version marker", "response_contract_version: 1"),
        ("provider marker", 'provider: "flutterwave"'),
        ("status filter guard", "ALLOWED_STATUS"),
        ("source filter guard", "ALLOWED_SOURCE"),
        ("channel filter guard", "ALLOWED_CHANNEL"),
        ("channel whitelist message", "channel must be bank or mobile_money"),
        ("source whitelist message", "source must be flutterwave"),
        ("direction echoed in filters", 'direction: "receive"'),
        ("pagination has_more", "has_more: Boolean(nextBefore)"),
        ("pagination next_before", "next_before: nextBefore"),
        ("pagination returned_count", "returned_count: rows.length"),
        ("capability guard", "getFlutterwaveCapabilities"),
        ("receive-enabled guard", "flutterwave_receive_disabled"),
    ]
    missing = [label for label, token in required if token not in text]
    if missing:
        return fail("missing tokens: " + ", ".join(missing))

    if not CFG.exists():
        return fail("missing file: supabase/config.toml")
    cfg = CFG.read_text(encoding="utf-8")
    if not re.search(r"\[functions\.flutterwave-collections-list\]\s*verify_jwt\s*=\s*true", cfg, re.MULTILINE):
        return fail("supabase/config.toml missing flutterwave-collections-list verify_jwt=true pin")

    print("[OK] flutterwave-collections-list endpoint enforces auth + ownership + receive scope + flutterwave source lock")
    print("flutterwave_collections_list_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

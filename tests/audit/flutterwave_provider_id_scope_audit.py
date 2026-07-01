#!/usr/bin/env python3
"""
Ensure provider_transfer_id uniqueness is scoped by source.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20260701011000_flutterwave_provider_id_scope_source.sql"


def main() -> int:
    if not MIGRATION.exists():
        print("flutterwave_provider_id_scope_audit: FAIL")
        print(" - missing file: supabase/migrations/20260701011000_flutterwave_provider_id_scope_source.sql")
        return 1

    text = MIGRATION.read_text(encoding="utf-8")
    checks = [
        "drop index if exists public.flw_transfers_provider_id_uq;",
        "create unique index if not exists flw_transfers_source_provider_id_uq",
        "on public.flutterwave_transfers (source, provider_transfer_id)",
    ]
    missing = [token for token in checks if token not in text]
    if missing:
        print("flutterwave_provider_id_scope_audit: FAIL")
        for token in missing:
            print(f" - missing token: {token}")
        return 1

    print("[OK] provider_transfer_id uniqueness is source-scoped")
    print("flutterwave_provider_id_scope_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())


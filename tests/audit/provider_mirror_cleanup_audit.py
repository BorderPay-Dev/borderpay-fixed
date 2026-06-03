#!/usr/bin/env python3
"""
Provider mirror cleanup audit.

Locks the #75 cleanup contract:
  C1. public.users no longer carries provider customer ids.
  C2. get-user-profile reads bridge_customer_id only from user_profiles.
  C3. A cleanup migration drops the legacy mirror and removed-provider columns.
  C4. Removed-provider sync/runtime branches are not present in current function source.
  C5. Card API state is locked, not coming-soon.

Historical migrations are excluded: they must remain replayable history.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def table_block(schema: str, table: str) -> str:
    m = re.search(
        rf"create table if not exists public\.{re.escape(table)}\s*\((.*?)\n\);",
        schema,
        re.DOTALL | re.IGNORECASE,
    )
    return m.group(1) if m else ""


def main() -> int:
    schema = read("utils/supabase/schema.sql")
    users_block = table_block(schema, "users")
    profile_block = table_block(schema, "user_profiles")
    get_profile = read("supabase/functions/get-user-profile/index.ts")
    worker = read("supabase/functions/process-pending-events/index.ts")
    backend_api = read("utils/api/backendAPI.ts")
    migration_paths = sorted((ROOT / "supabase" / "migrations").glob("*final_provider_mirror_cleanup.sql"))
    migration = migration_paths[-1].read_text(encoding="utf-8") if migration_paths else ""

    checks: list[tuple[str, bool, str]] = []

    checks.append((
        "C1 users mirror has no provider customer id columns",
        "bridge_customer_id" not in users_block
        and "maplerad_" not in users_block.lower()
        and "bridge_customer_id" in profile_block,
        "public.users must not carry bridge_customer_id or removed-provider columns; user_profiles remains canonical",
    ))

    checks.append((
        "C2 get-user-profile no longer falls back to users.bridge_customer_id",
        "userData?.bridge_customer_id" not in get_profile
        and "profile?.bridge_customer_id || null" in get_profile,
        "get-user-profile must read canonical bridge_customer_id from user_profiles only",
    ))

    checks.append((
        "C3 migration drops legacy mirror and removed-provider columns",
        "drop column if exists bridge_customer_id" in migration
        and "alter table public.users" in migration
        and "alter table public.user_profiles" in migration
        and "drop column if exists maplerad_customer_id" in migration
        and "drop column if exists maplerad_provider_meta" in migration,
        "cleanup migration must defensively drop users.bridge_customer_id and removed-provider columns",
    ))

    checks.append((
        "C4 removed-provider sync function and worker branch are gone",
        not (ROOT / "supabase" / "functions" / "sync-users-to-maplerad" / "index.ts").exists()
        and 'case "maplerad"' not in worker
        and "provider_removed: \"maplerad\"" not in worker,
        "current backend source must not keep removed-provider sync or special queue branch",
    ))

    checks.append((
        "C5 cards API is locked, not coming-soon",
        "const CARDS_LOCKED" in backend_api
        and "cards_locked" in backend_api
        and "CARDS_COMING_SOON" not in backend_api
        and "cards_coming_soon" not in backend_api,
        "card API must expose the locked state, not a coming-soon mock state",
    ))

    ok = True
    print("provider_mirror_cleanup_audit:")
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for _, p, _ in checks if p)}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

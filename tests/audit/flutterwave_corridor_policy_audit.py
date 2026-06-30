#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]


def must_have(path: str, token: str) -> bool:
    p = ROOT / path
    if not p.exists():
        print(f"[FAIL] Missing file: {path}")
        return False
    content = p.read_text(encoding="utf-8")
    if token not in content:
        print(f"[FAIL] Missing token in {path}: {token}")
        return False
    print(f"[OK] {path}: {token}")
    return True


def main() -> int:
    ok = True
    ok &= must_have(
        "supabase/migrations/20260630193000_provider_corridor_policy.sql",
        "create table if not exists public.provider_corridor_policy",
    )
    ok &= must_have(
        "supabase/functions/_shared/providers/provider-corridor-policy.ts",
        "evaluateProviderCorridorPolicy",
    )
    ok &= must_have(
        "supabase/functions/flutterwave-transfer-create/index.ts",
        "evaluateProviderCorridorPolicy",
    )
    ok &= must_have(
        "supabase/functions/flutterwave-transfer-create/index.ts",
        "destination_country is required",
    )
    if ok:
        print("flutterwave_corridor_policy_audit: PASS")
        return 0
    print("flutterwave_corridor_policy_audit: FAIL")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

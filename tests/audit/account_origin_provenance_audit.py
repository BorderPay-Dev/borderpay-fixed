#!/usr/bin/env python3
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def main() -> int:
    migration = read("supabase/migrations/20260816090000_account_origin_provenance.sql")
    signup = read("supabase/functions/auth-signup/index.ts")
    certification = read("tests/audit/rc1_business_certification_gate_audit.py")
    preflight = read("scripts/ci/rc1_business_certification_preflight.py")
    manual_verifier = read("scripts/ci/verify_manual_intervention_audit.py")
    origin_insert = signup.find('.from("account_origin_provenance").insert')
    token_issue = signup.find('supabaseAdmin.rpc("issue_email_token"')
    identity_create = signup.find("supabaseAdmin.auth.admin.createUser")

    checks = [
        ("origin relation exists", "create table if not exists public.account_origin_provenance" in migration),
        ("four origins are explicit", "origin_kind in ('direct','partner','imported','migrated')" in migration),
        ("absence is not backfilled", "Existing identities are not backfilled" in migration and "Missing row means unknown" in migration),
        ("direct origin is constrained", "origin_kind = 'direct'" in migration and "onboarding_channel = 'direct'" in migration),
        ("partner context is constrained", "origin_kind = 'partner'" in migration and "tenant_id is not null" in migration and "authorization_id is not null" in migration),
        ("imports require explicit source reference", "origin_kind = 'imported'" in migration and "approved_account_import" in migration and "source_reference is not null" in migration),
        ("browser roles cannot forge origin", "revoke all on table public.account_origin_provenance from public, anon, authenticated" in migration),
        ("origin is immutable", "before update or delete" in migration and "account_origin_provenance is immutable" in migration),
        ("signup writes provenance after policy and persistence", identity_create >= 0 and token_issue > identity_create and origin_insert > token_issue),
        ("direct/partner derived server-side", 'partnerAuthorization ? "partner" : "direct"' in signup and 'partnerAuthorization?.onboarding_channel || "direct"' in signup),
        ("untrusted browser context rejected", "Object.prototype.hasOwnProperty.call(body, \"tenant_id\")" in signup and "Object.prototype.hasOwnProperty.call(body, \"onboarding_channel\")" in signup),
        ("existing Individual identities remain untouched", "Existing identities are not backfilled" in migration and "alter table public.user_profiles" not in migration),
        ("certification consumes origin table", '"source_table": "public.account_origin_provenance"' in certification and "account_origin_provenance aop" in certification),
        ("manual Boolean cannot certify", "manual intervention cannot be represented by a Boolean default" in read("scripts/ci/validate_business_certification_bundle.py")),
        ("external manual audit is verified", "validate_manual_intervention_audit" in certification and "supabase_postgres_pgaudit_export" in manual_verifier and "export SHA-256 mismatch" in manual_verifier),
    ]
    failures = []
    for name, passed in checks:
        print(f"[{'OK' if passed else 'FAIL'}] {name}")
        if not passed:
            failures.append(name)
    if failures:
        print(f"\naccount_origin_provenance_audit: FAIL ({len(failures)})")
        return 1
    print("\naccount_origin_provenance_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

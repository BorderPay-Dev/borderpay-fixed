#!/usr/bin/env python3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def main() -> int:
    migration = read("supabase/migrations/20260822090000_certification_external_audit_ledger.sql")
    schedule = read("supabase/migrations/20260823090000_certification_audit_delivery_schedule.sql")
    worker = read("supabase/functions/certification-audit-delivery/index.ts")
    verifier = read("scripts/ci/verify_external_audit_ledger.py")
    preflight = read("scripts/ci/rc1_business_certification_preflight.py")
    checks = [
        ("critical row mutations are captured", "after insert or update or delete" in migration),
        ("truncate operations are captured", "after truncate" in migration),
        ("events are globally sequenced", "pg_advisory_xact_lock" in migration and "last_sequence" in migration),
        ("events are hash chained", "previous_hash" in migration and "digest(convert_to(prior_hash || payload" in migration),
        ("audit rows are append-only", "certification audit ledger is append-only" in migration),
        ("browser and service roles cannot insert audit events", "revoke all on public.certification_audit_events from public, anon, authenticated, service_role" in migration),
        ("sensitive authentication secrets are not exported", "encrypted_password" not in migration and "confirmation_token" not in migration),
        ("delivery claims use skip locked", "for update skip locked" in migration),
        ("delivery runs every minute", "'certification-audit-delivery'" in schedule and "'* * * * *'" in schedule),
        ("scheduler credentials come from Vault", "vault.decrypted_secrets" in schedule and "certification_audit_worker_token" in schedule),
        ("scheduler fails closed without configuration", "worker URL is missing or invalid" in schedule and "worker token is missing or invalid" in schedule),
        ("scheduler accepts only the audit worker HTTPS endpoint", "supabase[.]co/functions/v1/certification-audit-delivery" in schedule),
        ("scheduler is not callable by API roles", "from public, anon, authenticated, service_role" in schedule),
        ("sink transport is HTTPS and authenticated", "must use HTTPS" in worker and "CERTIFICATION_AUDIT_SINK_TOKEN" in worker),
        ("sink request is integrity protected", "CERTIFICATION_AUDIT_OUTBOUND_HMAC_SECRET" in worker and "x-borderpay-audit-signature" in worker),
        ("sink receipt is independently verified", "CERTIFICATION_AUDIT_SINK_PUBLIC_KEY_BASE64" in worker and "verifySinkReceipt" in worker),
        ("object lock is fail closed", 'object_lock_mode !== "COMPLIANCE"' in read("supabase/functions/_shared/certification-audit.ts")),
        ("verifier detects sequence gaps", "external audit sequence gap" in verifier),
        ("verifier recomputes event hashes", "external audit event hash mismatch" in verifier),
        ("verifier validates signed receipts", "external audit receipt signature invalid" in verifier),
        ("preflight requires immutable external sink", "external audit sink must enforce COMPLIANCE object lock" in preflight),
    ]
    failures = []
    for name, passed in checks:
        print(f"[{'OK' if passed else 'FAIL'}] {name}")
        if not passed:
            failures.append(name)
    if failures:
        print(f"\ncertification_external_audit_control_audit: FAIL ({len(failures)})")
        return 1
    print("\ncertification_external_audit_control_audit: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

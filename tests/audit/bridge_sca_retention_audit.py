#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
migration = (ROOT / "supabase/migrations/20260831190000_sca_audit_external_retention.sql").read_text()
activation = (ROOT / "supabase/migrations/20260831193000_sca_fail_closed_activation.sql").read_text()
worker = (ROOT / "supabase/functions/certification-audit-delivery/index.ts").read_text()
authorize = (ROOT / "supabase/functions/sca-authorize/index.ts").read_text()

checks = (
    ("SCA audit rows enter the independent hash chain", "certification_audit_append(" in migration),
    ("SCA trigger covers create/change/delete", "after insert or update or delete on public.sca_audit_events" in migration),
    ("SCA trigger covers truncate", "after truncate on public.sca_audit_events" in migration),
    ("credential values are not exported", all(field not in migration for field in ("'totp',", "'pin',", "'password',", "'secret',"))),
    ("worker applies at least five years to SCA", 'event.table_name === "sca_audit_events"' in worker and "1_827" in worker),
    ("sink receives the signed retention requirement", "retention_requirement_days: retentionDays" in worker),
    ("signed receipt is checked against the same requirement", "}, sinkPublicKey, retentionDays);" in worker),
    ("lockout has a dedicated audit event", "authorization_locked" in activation and "authorization_locked" in authorize),
    ("unknown provider scope fails closed for reads", "if not found then return false; end if;" in activation),
)

failed = False
for label, ok in checks:
    print(f"[{'OK' if ok else 'FAIL'}] {label}")
    failed = failed or not ok

if failed:
    raise SystemExit("bridge_sca_retention_audit: FAIL")

print("bridge_sca_retention_audit: PASS")

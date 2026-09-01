#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
migration = (ROOT / "supabase/migrations/20260901120000_bridge_eea_sca_controlled_activation.sql").read_text()
shared = (ROOT / "supabase/functions/_shared/sca.ts").read_text()
authorize = (ROOT / "supabase/functions/sca-authorize/index.ts").read_text()

checks = (
    ("database enforcement defaults off", "enforcement_enabled boolean not null default false" in migration),
    ("database policy reads release control", "if not coalesce(v_enforcement_enabled, false) then return true" in migration),
    ("activation preflight exists", "bridge_eea_sca_activation_preflight" in migration),
    ("activation requires zero missing scopes", "missing_or_expired_scopes" in migration and "= 0" in migration),
    ("runtime gate is explicitly Bridge EEA", "BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED" in shared and "BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED" in authorize),
    ("legacy global flag is absent", "UNIVERSAL_SCA_ENFORCEMENT_ENABLED" not in shared and "UNIVERSAL_SCA_ENFORCEMENT_ENABLED" not in authorize),
)

failed = []
for label, passed in checks:
    print(f"[{'OK' if passed else 'FAIL'}] {label}")
    if not passed:
        failed.append(label)
if failed:
    raise SystemExit(1)
print("bridge_sca_activation_gate_audit: PASS")

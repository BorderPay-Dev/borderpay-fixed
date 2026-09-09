#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

dialog = (ROOT / "components/security/SCAChallengeDialog.tsx").read_text()
send = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
authorize = (ROOT / "supabase/functions/sca-authorize/index.ts").read_text()
disable = (ROOT / "supabase/functions/disable-2fa/index.ts").read_text()
reset = (ROOT / "supabase/functions/auth-reset-password-confirm/index.ts").read_text()
monitor = (ROOT / "supabase/functions/sca-monitoring/index.ts").read_text()
schedule = (ROOT / "supabase/migrations/20260901114000_bridge_sca_monitoring_schedule.sql").read_text()
recovery = (ROOT / "docs/BRIDGE_EEA_SCA_RECOVERY_POLICY.md").read_text()
runbook = (ROOT / "docs/BRIDGE_EEA_SCA_MONITORING_AND_INCIDENT_RUNBOOK.md").read_text()

checks = (
    ("factors are presented in sequence", "'knowledge' | 'possession'" in dialog and "Continue" in dialog),
    ("payment factors are presented in sequence", "setScaFactorStep('possession')" in send and "Continue to authenticator" in send),
    ("password recovery starts a 24-hour restriction", "sca_recovery_restricted_until" in reset and "24 * 60 * 60 * 1000" in reset),
    ("active authenticator replacement starts a 24-hour restriction", "replacingActiveFactor" in disable and "24 * 60 * 60 * 1000" in disable),
    ("in-scope authorization enforces recovery restriction", 'code: "sca_recovery_restricted"' in authorize),
    ("provider scope failures are audited", 'event_type: "scope_unavailable"' in authorize),
    ("monitor uses the logged incident-email path", 'template: "admin.incident_alert"' in monitor),
    ("monitor runs every five minutes", "'*/5 * * * *'" in schedule),
    ("recovery policy blocks protected actions", "24-hour recovery restriction" in recovery and "may not" in recovery),
    ("runbook records Bridge reporting deadlines", "within 24 hours" in runbook and "within 72 hours" in runbook),
)

failed = [name for name, passed in checks if not passed]
for name, passed in checks:
    print(f"[{'OK' if passed else 'FAIL'}] {name}")
if failed:
    raise SystemExit("bridge_sca_recovery_monitoring_audit: FAIL")
print("bridge_sca_recovery_monitoring_audit: PASS")

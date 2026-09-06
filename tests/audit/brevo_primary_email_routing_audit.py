#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
functions = root / "supabase/functions"
sender = (functions / "send-email/index.ts").read_text()
legacy = (functions / "send-confirmation-email/index.ts").read_text()
bridge = (functions / "bridge-webhook/index.ts").read_text()

direct_provider_callers = []
for path in functions.rglob("*.ts"):
    if path == functions / "send-email/index.ts":
        continue
    source = path.read_text()
    if "api.brevo.com" in source or "api.resend.com" in source:
        direct_provider_callers.append(str(path.relative_to(root)))

checks = {
    "Brevo-first failover order is implemented": 'EMAIL_PROVIDER === "brevo_then_resend"' in sender and '["brevo" as const]' in sender and '["resend" as const]' in sender,
    "only unified dispatcher calls email providers": not direct_provider_callers,
    "legacy confirmation delegates to dispatcher": "/functions/v1/send-email" in legacy and "SEND_EMAIL_INTERNAL_TOKEN" in legacy,
    "Bridge incident alerts delegate to dispatcher": "/functions/v1/send-email" in bridge and 'template: "admin.incident_alert"' in bridge,
    "provider success and failure remain logged": 'status:    "sent"' in sender and "markFailed" in sender,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"{'PASS' if ok else 'FAIL'}: {name}")
if direct_provider_callers:
    print("Direct provider callers:", ", ".join(direct_provider_callers))
if failed:
    raise SystemExit("Brevo primary routing audit failed: " + ", ".join(failed))
print(f"Brevo primary routing audit passed ({len(checks)}/{len(checks)}).")

#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
worker = (ROOT / "supabase/functions/process-pending-events/index.ts").read_text()

checks = {
    "event subtype can establish deactivation when object status is absent": all(marker in worker for marker in [
        "event.includes(\"deactivat\")",
        "event.includes(\"inactive\")",
        "ev.payload?.type ?? ev.payload?.event_type",
    ]),
    "webhook deactivation timestamp is persisted": all(marker in worker for marker in [
        "const newlyDeactivated",
        'deactivation_reason: "bridge_webhook"',
        "deactivated_at: new Date().toISOString()",
    ]),
    "reactivation clears deactivation metadata": all(marker in worker for marker in [
        "reactivatedBySupport",
        "deactivated_at: null",
        "deactivation_reason: null",
    ]),
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"[{'PASS' if passed else 'FAIL'}] {name}")
if failed:
    raise SystemExit(1)
print("bridge_va_webhook_lifecycle_projection_audit: PASS")

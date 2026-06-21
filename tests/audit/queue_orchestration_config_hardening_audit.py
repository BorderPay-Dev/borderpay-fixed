#!/usr/bin/env python3
"""
Queue orchestration config hardening audit.

Checks:
  Q1 hardening migration exists and removes placeholder dependency.
  Q2 trigger reads app.process_pending_events_url + app.process_pending_events_jwt.
  Q3 cron drain schedule calls wrapper function (no hardcoded project URL).
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIG = ROOT / "supabase" / "migrations" / "20260619123000_queue_orchestration_and_signup_lock_hardening.sql"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    mig = read(MIG)

    checks: list[tuple[str, bool, str]] = []

    checks.append((
        "Q1 migration present and no placeholder URL",
        ("create or replace function public.fire_pending_event_webhook()" in mig and
         "https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-pending-events" not in mig),
        "expected queue hardening migration without hardcoded placeholder endpoint URLs",
    ))

    checks.append((
        "Q2 trigger uses DB settings for URL/JWT",
        ("app.process_pending_events_url" in mig and
         "app.process_pending_events_jwt" in mig and
         "current_setting('app.process_pending_events_url'" in mig),
        "fire_pending_event_webhook should read URL/JWT from DB GUC settings",
    ))

    checks.append((
        "Q3 cron drain uses wrapper",
        ("invoke_process_pending_events_drain" in mig and
         "process-pending-events-drain" in mig and
         "select public.invoke_process_pending_events_drain(50);" in mig),
        "cron should invoke wrapper function instead of hardcoded endpoint",
    ))

    print("queue_orchestration_config_hardening_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

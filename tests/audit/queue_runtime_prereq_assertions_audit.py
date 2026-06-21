#!/usr/bin/env python3
"""
Queue runtime prerequisite assertion audit.

Checks:
  P1 migration asserts pending_events + webhook_logs tables exist.
  P2 migration asserts claim/complete/fail/reap queue RPCs exist.
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIG = ROOT / "supabase" / "migrations" / "20260619124500_queue_runtime_prereq_assertions.sql"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    mig = read(MIG)

    checks: list[tuple[str, bool, str]] = []

    checks.append((
      "P1 table assertions present",
      ("to_regclass('public.pending_events')" in mig and
       "to_regclass('public.webhook_logs')" in mig),
      "expected table existence assertions for pending_events and webhook_logs",
    ))

    checks.append((
      "P2 queue RPC assertions present",
      all(x in mig for x in [
        "p.proname = 'claim_pending_events'",
        "p.proname = 'complete_pending_event'",
        "p.proname = 'fail_pending_event'",
        "p.proname = 'reap_stuck_processing'",
      ]),
      "expected assertions for claim/complete/fail/reap queue functions",
    ))

    print("queue_runtime_prereq_assertions_audit:")
    ok = True
    for name, passed, detail in checks:
      print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
      ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

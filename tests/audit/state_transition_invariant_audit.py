#!/usr/bin/env python3
"""
Read-only lifecycle state-transition invariant audit.

Detects blocker anomalies that indicate illegal transition effects or impossible
historical regressions from current state snapshots.
"""
from __future__ import annotations

import json
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def run(cmd: str) -> tuple[int, str, str]:
    p = subprocess.run(["/bin/zsh", "-lc", cmd], capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def query(sql: str) -> list[dict]:
    sql = sql.replace('"', '\\"')
    cmd = (
        f"cd {shlex.quote(str(ROOT))} && "
        f"SUPABASE_DISABLE_TELEMETRY=1 supabase db query --linked -o json \"{sql}\""
    )
    rc, out, err = run(cmd)
    if rc != 0:
        raise RuntimeError((out + "\n" + err).strip())
    return json.loads(out).get("rows", [])


def main() -> int:
    checks: list[tuple[str, bool, str]] = []

    rows = query(
        """
        select
          (select count(*) from public.pending_events where status in ('queued','processing') and completed_at is not null) as pe_completed_regression,
          (select count(*) from public.pending_events where status='queued' and attempts>=max_attempts) as pe_retry_invariant_broken,
          (select count(*) from public.pending_events where status='processing' and locked_at is null) as pe_processing_without_lock,
          (select count(*) from public.bridge_webhook_events where processing_status='queued' and pending_event_id is null) as bwe_queued_without_pending,
          (select count(*) from public.bridge_webhook_events where processing_status='rejected' and signature_ok=true) as bwe_rejected_signature_true,
          (select count(*) from public.bridge_transfers where lower(coalesce(state,'')) not in ('pending','succeeded','failed','cancelled','returned','refunded')) as bt_unknown_state,
          (select count(*) from public.bridge_transfers where updated_at < created_at) as bt_time_regression;
        """
    )
    if not rows:
        print("state_transition_invariant_audit: FAIL no rows returned")
        return 1

    r = rows[0]
    mapping = [
        ("T1 pending_events completed regression", "pe_completed_regression"),
        ("T2 pending_events retry invariant", "pe_retry_invariant_broken"),
        ("T3 pending_events processing lock invariant", "pe_processing_without_lock"),
        ("T4 bridge_webhook_events queued linkage", "bwe_queued_without_pending"),
        ("T5 bridge_webhook_events reject/signature invariant", "bwe_rejected_signature_true"),
        ("T6 bridge_transfers known state set", "bt_unknown_state"),
        ("T7 bridge_transfers timestamp monotonicity", "bt_time_regression"),
    ]

    print("state_transition_invariant_audit:")
    failed = 0
    for label, key in mapping:
        n = int(r.get(key, 0) or 0)
        ok = n == 0
        checks.append((label, ok, f"count={n}"))
        print(f"  {'PASS' if ok else 'FAIL'} {label} -> count={n}")
        if not ok:
            failed += 1

    if failed:
        print(f"\nFAIL ({failed}/{len(mapping)} checks failed)")
        return 1
    print(f"\nPASS ({len(mapping)}/{len(mapping)} checks passed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

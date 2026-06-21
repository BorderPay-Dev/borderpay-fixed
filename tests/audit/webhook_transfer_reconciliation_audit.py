#!/usr/bin/env python3
"""
Webhook transfer reconciliation audit.

Checks:
  W1 migration defines reconciliation columns (optional capability).
  W2 worker does not hard-depend on undeployed reconciliation columns.
  W3 unmapped ownership raises reconciliation_required (cannot be silently ignored).
  W4 reconciliation reason is preserved in raw payload for operator review.
"""
from __future__ import annotations
import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIG = ROOT / "supabase" / "migrations" / "20260619103000_security_abuse_and_reconciliation_hardening.sql"
WORKER = ROOT / "supabase" / "functions" / "process-pending-events" / "index.ts"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    mig = read(MIG)
    worker = read(WORKER)

    checks: list[tuple[str, bool, str]] = []

    checks.append((
        "W1 reconciliation schema in bridge_transfers",
        all(x in mig for x in [
            "add column if not exists reconciliation_status",
            "add column if not exists reconciliation_reason",
            "bt_reconciliation_needed_idx",
        ]),
        "missing reconciliation columns/index on bridge_transfers",
    ))

    checks.append((
        "W2 worker avoids undeployed reconciliation column dependency",
        (re.search(r"\breconciliation_status\s*:", worker) is None and
         re.search(r"\breconciliation_reason\s*:", worker) is None and
         re.search(r"\breconciliation_required_at\s*:", worker) is None and
         re.search(r"\breconciled_at\s*:", worker) is None),
        "worker should not write reconciliation columns directly in bridge_transfers upsert",
    ))

    checks.append((
        "W3 worker fails closed on unmapped ownership",
        "reconciliation_required:" in worker,
        "worker should raise reconciliation_required on unmapped ownership to avoid silent completion",
    ))

    checks.append((
        "W4 worker preserves reconciliation reason in raw payload",
        "borderpay_reconciliation_reason" in worker,
        "worker should include reconciliation reason in bridge_transfers.raw metadata",
    ))

    print("webhook_transfer_reconciliation_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

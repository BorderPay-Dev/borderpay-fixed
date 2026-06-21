#!/usr/bin/env python3
"""
Provisioning lock resilience audit.

Checks that worker-level stablecoin provisioning dedupe exists and is
implemented with a deterministic, cross-worker DB lock primitive.
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "supabase" / "functions" / "process-pending-events" / "index.ts"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def main() -> int:
    src = read(WORKER)
    checks: list[tuple[str, bool, str]] = []

    checks.append((
        "P1 deterministic provisioning lock event id",
        "provisioningLockEventId(" in src and "provlock:wallet:" in src,
        "missing deterministic lock key for customer+symbol+chain",
    ))
    checks.append((
        "P2 lock acquisition uses durable DB row",
        '.from("webhook_logs")' in src and "tryAcquireProvisioningLock(" in src,
        "missing webhook_logs-backed lock acquisition",
    ))
    checks.append((
        "P3 stale-lock takeover logic exists",
        "PROVISIONING_LOCK_STALE_SECONDS" in src and ".lte(\"received_at\"" in src and "state=takeover" in src,
        "missing stale lock takeover (restart/retry resilience)",
    ))
    checks.append((
        "P4 lock completion + failure paths exist",
        "completeProvisioningLock(" in src and "failProvisioningLock(" in src,
        "missing lock terminal update paths",
    ))
    checks.append((
        "P5 wallet provisioning path gates on lock state",
        "already_completed" in src and 'lock.state === "busy"' in src,
        "missing lock-state guards before Bridge provisioning calls",
    ))

    print("provisioning_lock_resilience_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())


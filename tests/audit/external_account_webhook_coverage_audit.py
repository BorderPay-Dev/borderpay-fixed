#!/usr/bin/env python3
"""
External account webhook coverage audit.

Verifies worker router and handler coverage for Bridge external_account events,
including safe handling of unknown/malformed payloads.
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
        "E1 router handles external_account.* events",
        'case "bridge.external_account":' in src and "handleBridgeExternalAccount(" in src,
        "missing external_account router branch via canonical ingress route_bucket",
    ))
    checks.append((
        "E2 handler writes bridge_external_accounts projection",
        '.from("bridge_external_accounts").upsert(' in src,
        "missing external account projection upsert",
    ))
    checks.append((
        "E3 malformed events complete safely (missing ids)",
        "missing_external_account_id" in src and "missing_customer_id" in src and "complete_pending_event" in src,
        "missing safe-complete path for malformed external_account events",
    ))
    checks.append((
        "E4 completion summary preserves observability",
        "kind: \"external_account\"" in src and "recognized_event" in src,
        "missing external-account observability summary fields",
    ))

    print("external_account_webhook_coverage_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

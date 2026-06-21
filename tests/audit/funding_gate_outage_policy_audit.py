#!/usr/bin/env python3
"""
Funding gate outage policy audit.

Ensures Bridge-balance dependency is explicit and fail-closed on provider
outage; no VA-balance fallback, no synthetic FX logic.
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GATE = ROOT / "supabase" / "functions" / "_shared" / "funding-gate.ts"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def main() -> int:
    src = read(GATE)
    checks: list[tuple[str, bool, str]] = []

    checks.append((
        "F1 outage policy constant exists",
        "FUNDING_OUTAGE_POLICY" in src,
        "missing explicit outage policy constant",
    ))
    checks.append((
        "F2 default fail-closed policy",
        '|| "fail_closed"' in src and 'policy: "fail_closed"' in src,
        "missing fail_closed default behavior",
    ))
    checks.append((
        "F3 provider outage returns balance_unavailable",
        "funding_balance_unavailable" in src and "status: 503" in src,
        "missing explicit 503 balance_unavailable response",
    ))
    checks.append((
        "F4 no virtual-account balance source",
        "bridge_virtual_account_balances" not in src,
        "VA balances should never satisfy funding gate",
    ))
    checks.append((
        "F5 no synthetic FX conversion map",
        "FX_TO_USD" not in src and "sumVirtualAccountBalancesUsd" not in src,
        "legacy FX/VA conversion logic should be removed",
    ))

    print("funding_gate_outage_policy_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())


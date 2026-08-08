#!/usr/bin/env python3
"""Fail if bridge-transfer regresses billing, Bridge payload, or freeze guards."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "supabase/functions/bridge-transfer/index.ts").read_text()

checks = {
    "legacy maintenance block removed": (
        "maintenance_due" not in SOURCE and "maintenance_overdue" not in SOURCE
    ),
    "Bridge destination chain stripped": (
        'filter(([key]) => key !== "chain")' in SOURCE
        and "chain:        transferChain" not in SOURCE
    ),
    "frozen-account guard preserved": (
        "getFinancialAccessBlock" in SOURCE and "if (accessBlock)" in SOURCE
    ),
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("bridge_transfer_runtime_regression_audit: FAIL\n- " + "\n- ".join(failed))

print("bridge_transfer_runtime_regression_audit: PASS")

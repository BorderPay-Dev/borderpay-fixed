#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

cache_scope = (ROOT / "utils/financial/cacheScope.ts").read_text()
dashboard = (ROOT / "components/app/Dashboard.tsx").read_text()

checks = [
    (
        "explicit user id wins financial cache scope",
        'userId: fallbackUserId || cachedUserId || "anon"' in cache_scope,
    ),
    (
        "dashboard reads canonical persisted financial snapshot",
        "readPersistedFinancialSnapshot" in dashboard
        and "borderpay_snapshot_cache_v2" in dashboard,
    ),
    (
        "dashboard wallet first-paint can seed from snapshot wallets",
        "dashboardWalletRowsFromSnapshot(cachedSnapshot)" in dashboard,
    ),
    (
        "dashboard recent activity can seed from snapshot transactions",
        "snapshot?.transactions" in dashboard
        and "return snapshotTx.slice(0, 5)" in dashboard,
    ),
]

failed = False
for label, ok in checks:
    print(f"[{'OK' if ok else 'FAIL'}] {label}")
    failed = failed or not ok

if failed:
    raise SystemExit("dashboard_instant_financial_cache_audit: FAIL")

print("dashboard_instant_financial_cache_audit: PASS")

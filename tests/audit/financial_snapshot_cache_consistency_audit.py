from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

backend = (ROOT / "utils/api/backendAPI.ts").read_text()
dashboard = (ROOT / "components/app/Dashboard.tsx").read_text()
transactions = (ROOT / "components/transactions/TransactionsScreen.tsx").read_text()
notifications = (ROOT / "components/notifications/NotificationsScreen.tsx").read_text()

failures = []

wallet_route_start = backend.find("async getWalletRouteData()")
wallet_route_end = backend.find("async getReceiveRouteData()", wallet_route_start)
wallet_route = backend[wallet_route_start:wallet_route_end]
if "financialReadModelAPI.getSnapshot(100)" not in wallet_route:
    failures.append("Wallet route data must read the canonical financial snapshot before direct wallet fallback.")
if "snapshot_source: 'financial_snapshot'" not in wallet_route:
    failures.append("Wallet route data must mark snapshot-sourced payloads for auditability.")

if "const TX_CACHE_KEY     = 'borderpay_tx_history_v1';" not in dashboard:
    failures.append("Dashboard must use the same transaction cache key as Transactions/Notifications.")
if "readRecentActivityCache(userId, dashRecentKey)" not in dashboard:
    failures.append("Dashboard recent activity must seed from the shared transaction cache.")
if "writeJSON(financialCacheKey(TX_CACHE_KEY, { userId }), txns)" not in dashboard:
    failures.append("Dashboard snapshot refresh must update the shared transaction cache.")

for name, src in {
    "TransactionsScreen": transactions,
    "NotificationsScreen": notifications,
}.items():
    if "const TX_CACHE_KEY = 'borderpay_tx_history_v1';" not in src:
        failures.append(f"{name} must keep using the shared transaction cache key.")
    if "backendAPI.financial.getSnapshot" not in src:
        failures.append(f"{name} must refresh from the canonical financial snapshot.")

if failures:
    print("financial_snapshot_cache_consistency_audit: FAIL")
    for failure in failures:
        print(f"- {failure}")
    raise SystemExit(1)

print("financial_snapshot_cache_consistency_audit: PASS")

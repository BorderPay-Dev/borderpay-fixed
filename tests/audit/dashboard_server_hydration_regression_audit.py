from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = (ROOT / "components/app/Dashboard.tsx").read_text()
APP = (ROOT / "App.tsx").read_text()

failures = []
if "12_000" not in DASHBOARD or "snapshot_timeout" not in DASHBOARD:
    failures.append("cold production snapshots can still be cut off by the old 1.8 second deadline")
if "if (snapshotOk) setWalletsLoaded(true)" not in DASHBOARD:
    failures.append("a failed snapshot can still confirm an empty dashboard")
if "bridge_wallet_id: w?.bridge_wallet_id" not in DASHBOARD:
    failures.append("provisioned zero-balance Bridge wallets are not preserved")
if "dataLoadError && accountChipCount === 0" not in DASHBOARD or "retryDashboardData" not in DASHBOARD:
    failures.append("cold-load failure has no explicit recovery state")
if "backendAPI.financial.invalidateForUser" not in APP:
    failures.append("fresh login can reuse a stale empty financial snapshot")
if "setAppLocked(false)" not in APP:
    failures.append("successful login does not clear the in-memory app lock")

if failures:
    print("dashboard_server_hydration_regression_audit: FAIL")
    for failure in failures:
        print(f" - {failure}")
    raise SystemExit(1)

print("dashboard_server_hydration_regression_audit: PASS")

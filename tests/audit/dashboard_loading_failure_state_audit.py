#!/usr/bin/env python3
from pathlib import Path


root = Path(__file__).resolve().parents[2]
source = (root / "components/app/Dashboard.tsx").read_text(encoding="utf-8")

loading_guard = "loading && !walletsLoaded && accountChipCount === 0"

if source.count(loading_guard) != 3:
    raise SystemExit(
        "FAIL: every cold-load skeleton must be gated by the active loading state"
    )

if "!walletsLoaded && accountChipCount === 0 ?" in source.replace(loading_guard, ""):
    raise SystemExit(
        "FAIL: a settled failed request can still render the loading skeleton"
    )

if "dataLoadError && accountChipCount === 0" not in source:
    raise SystemExit("FAIL: missing explicit account-load failure state")

if "onClick={retryDashboardData}" not in source:
    raise SystemExit("FAIL: account-load failure state is not retryable")

print("dashboard_loading_failure_state_audit: PASS")

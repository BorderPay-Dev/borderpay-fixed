#!/usr/bin/env python3
"""
Regression guard for business mobile/TestFlight screens.

Live invariants:
- Developer API access is discoverable from Settings and the drawer, not as a
  dashboard feed card.
- Business dashboard total balance uses the same mobile-native rounded hero
  treatment as the individual dashboard.
- Transactions, notifications, and team must not use short artificial timeout
  races that turn slow mobile networks into false error screens.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    path = ROOT / rel
    if not path.is_file():
        raise AssertionError(f"missing file: {rel}")
    return path.read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    dashboard = read("components/business/BusinessDashboard.tsx")
    settings = read("components/settings/SettingsScreen.tsx")
    shell = read("components/shell/AppShell.tsx")
    transactions = read("components/transactions/TransactionsScreen.tsx")
    notifications = read("components/notifications/NotificationsScreen.tsx")
    team = read("components/team/TeamScreen.tsx")

    require("Developer API access" not in dashboard, "Developer API card must not be on business dashboard")
    require("Issued by BorderPay" not in dashboard, "Dashboard must not show Developer API promo badge")
    require("rounded-3xl border border-white/[0.06] bg-gradient-to-br" in dashboard, "Business balance hero must be mobile-native")
    require("md:rounded-2xl md:border" not in dashboard, "Business balance card must not rely on desktop-only styling")

    require("Developer API" in settings and "https://docs.borderpayafrica.com" in settings, "Settings must expose developer docs")
    require("Developer API" in shell and "closeDrawerThen(openDeveloperDocs)" in shell, "Drawer must expose developer docs")

    require("TX_FETCH_TIMEOUT_MS" not in transactions and "withTimeout(" not in transactions, "Transactions must not use short timeout races")
    require("isRequestTimeout" in transactions, "Transactions must suppress transient timeout errors on cold start")

    require("NOTIFICATION_FETCH_TIMEOUT_MS" not in notifications and "withTimeout(" not in notifications, "Notifications must not use short timeout races")
    require("Promise.allSettled([" in notifications, "Notifications must tolerate one source failing")
    require("transientTimeout" in notifications, "Notifications must suppress transient timeout banners")

    require("TEAM_LOAD_TIMEOUT_MS" not in team and "withTimeout(" not in team, "Team must not block behind an artificial timeout")
    require("const [loading, setLoading]   = useState(false);" in team, "Team cold start must not show a blocking loader")
    require("Syncing team" not in team, "Team must not render the old cold-start syncing banner")

    print("business_mobile_regression_audit: PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print("business_mobile_regression_audit: FAIL", file=sys.stderr)
        print(f" - {exc}", file=sys.stderr)
        raise SystemExit(1)

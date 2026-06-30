#!/usr/bin/env python3
"""
Business Platform Navigation Audit (phase2, deployment-blocking).

Scope: platform-level routing/hydration patterns for business menu navigation.
Ensures route timing instrumentation exists and no global per-navigation
rehydration bottleneck is reintroduced in MainApp/AppShell/bootstrap.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    p = ROOT / rel
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def check(name: str, cond: bool, detail: str, failures: list[str]) -> None:
    if cond:
        print(f"[OK] {name}")
    else:
        print(f"[FAIL] {name}: {detail}")
        failures.append(name)


def main() -> int:
    failures: list[str] = []

    main_app = read("components/app/MainApp.tsx")
    backend = read("utils/api/backendAPI.ts")
    perf = read("utils/performance/navigationPerf.ts")

    check(
        "N1 route perf module exists",
        "export function navPerfStartRoute" in perf and "navPerfGetReport" in perf,
        "Missing central route perf instrumentation module",
        failures,
    )

    check(
        "N2 MainApp starts route metrics on navigation",
        "navPerfStartRoute(target, accountType);" in main_app,
        "navigateTo must start route perf tracking",
        failures,
    )

    check(
        "N3 MainApp marks first paint after route switch",
        "navPerfMarkRouteMounted(currentScreen)" in main_app
        and "navPerfMarkFirstPaint(currentScreen)" in main_app,
        "MainApp must mark route mount and first paint per route",
        failures,
    )

    check(
        "N4 MainApp exposes perf report helpers",
        "__borderpay_nav_perf_report" in main_app and "__borderpay_nav_perf_reset" in main_app,
        "Missing runtime perf export/reset helpers",
        failures,
    )

    check(
        "N5 API layer emits perf events for every endpoint call",
        "navPerfTrackApi(endpoint, 'start')" in backend and "navPerfTrackApi(endpoint, 'end'" in backend,
        "backend apiCall/apiCallPublic must emit route API telemetry",
        failures,
    )

    check(
        "N6 financial snapshot emits dedicated telemetry",
        "navPerfTrackSnapshot(true)" in backend and "navPerfTrackSnapshot(false)" in backend,
        "financial.getSnapshot must emit snapshot telemetry",
        failures,
    )

    # Platform bottleneck guard: shell snapshot/bootstrap effects must not be
    # tied to currentScreen (would rehydrate on every menu click).
    check(
        "N7 shell/bootstrap effects are not keyed by currentScreen",
        "}, [userId, accountType, refreshKey, updateUnreadCount]);" in main_app
        and "}, [userId, accountType, refreshKey]);" in main_app
        and "currentScreen" not in main_app.split("// ─── Shell snapshot", 1)[1].split("// ─── Load subscription", 1)[0],
        "MainApp shell snapshot effect must not depend on currentScreen",
        failures,
    )

    # Business menu route coverage tokens
    required_route_tokens = [
        "case 'dashboard':",
        "case 'wallet-detail':",
        "case 'receive-money':",
        "case 'send-money':",
        "case 'transactions':",
        "case 'notifications':",
        "case 'team':",
        "case 'settings':",
        "case 'profile':",
        "case 'external-accounts':",
        "case 'external-wallets':",
        "case 'bulk-payout':",
        "case 'payroll':",
        "case 'exchange':",
        "case 'ramps':",
    ]
    missing_routes = [tok for tok in required_route_tokens if tok not in main_app]
    check(
        "N8 business menu route coverage present in MainApp switch",
        not missing_routes,
        f"Missing route handlers: {missing_routes}",
        failures,
    )

    # Cache probes on core business surfaces for hit/miss visibility.
    cache_files = {
        "components/business/BusinessDashboard.tsx": "navPerfTrackCache('dashboard'",
        "components/wallet/WalletScreen.tsx": "navPerfTrackCache('wallet-detail'",
        "components/receive/ReceiveMoneyScreen.tsx": "navPerfTrackCache('receive-money'",
        "components/send/SendMoneyFlow.tsx": "navPerfTrackCache('send-money'",
        "components/business/BulkPayoutScreen.tsx": "navPerfTrackCache('bulk-payout'",
        "components/business/PayrollScreen.tsx": "navPerfTrackCache('payroll'",
        "components/business/PayrollComingSoonScreen.tsx": "navPerfTrackCache('payroll'",
        "components/business/RampsScreen.tsx": "navPerfTrackCache('ramps'",
        "components/exchange/ExchangeScreen.tsx": "navPerfTrackCache('exchange'",
        "components/transactions/TransactionsScreen.tsx": "navPerfTrackCache('transactions'",
        "components/notifications/NotificationsScreen.tsx": "navPerfTrackCache('notifications'",
        "components/team/TeamScreen.tsx": "navPerfTrackCache('team'",
        "components/settings/SettingsScreen.tsx": "navPerfTrackCache('settings'",
        "components/profile/ProfileScreen.tsx": "navPerfTrackCache('profile'",
        "components/payouts/ExternalAccountsScreen.tsx": "navPerfTrackCache('external-accounts'",
        "components/wallets/ExternalWalletsScreen.tsx": "navPerfTrackCache('external-wallets'",
    }
    missing_cache = []
    for rel, token in cache_files.items():
        src = read(rel)
        if token not in src:
            missing_cache.append(rel)
    check(
        "N9 core business routes emit cache hit/miss probes",
        not missing_cache,
        f"Missing cache probes: {missing_cache}",
        failures,
    )

    if failures:
        print(f"\nbusiness_platform_navigation_audit: FAIL ({len(failures)} checks)")
        return 1
    print("\nbusiness_platform_navigation_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

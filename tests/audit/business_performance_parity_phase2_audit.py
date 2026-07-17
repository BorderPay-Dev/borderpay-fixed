#!/usr/bin/env python3
"""
Business performance parity phase2 audit (static, deployment-blocking).

Goal: prevent business-visible routes from blocking first paint on non-critical
network work (capability/provisioning hydration loops) and enforce cache-first
render where equivalents exist.
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

    biz_dash = read("components/business/BusinessDashboard.tsx")
    wallet = read("components/wallet/WalletScreen.tsx")
    receive = read("components/receive/ReceiveMoneyScreen.tsx")
    send = read("components/send/SendMoneyFlow.tsx")
    notifications = read("components/notifications/NotificationsScreen.tsx")
    team = read("components/team/TeamScreen.tsx")
    external = read("components/payouts/ExternalAccountsScreen.tsx")
    profile = read("components/profile/ProfileScreen.tsx")

    # Dashboard parity: no cached-dashboard blanking on wallet refresh.
    check(
        "P1 Business dashboard refresh is cache-first",
        "if (wallets.length === 0) setWalletsLoading(true);" in biz_dash,
        "BusinessDashboard loadWallets must not set walletsLoading(true) when cache exists",
        failures,
    )

    # Wallet parity: snapshot first; provider sync/provision in background.
    check(
        "P2 Wallet route does not block on provider sync before snapshot",
        "await backendAPI.bridge.provisionStablecoins()" not in wallet
        and "await backendAPI.bridge.syncAccounts()" not in wallet
        and "Promise.allSettled([" in wallet,
        "WalletScreen must not await provision/sync before first snapshot render",
        failures,
    )

    # Receive parity: snapshot first; provider sync/provision in background.
    check(
        "P3 Receive route does not block on provider sync before snapshot",
        "await backendAPI.bridge.provisionStablecoins()" not in receive
        and "await backendAPI.bridge.syncAccounts()" not in receive
        and "Promise.allSettled([" in receive,
        "ReceiveMoneyScreen must not await provision/sync before first snapshot render",
        failures,
    )

    # Send parity: no pre-render gating on snapshot readiness.
    check(
        "P4 Send route renders without blocking hydration gate",
        "const [snapshotReady, setSnapshotReady] = useState(true);" in send,
        "SendMoneyFlow snapshotReady must default true (route render-first)",
        failures,
    )

    check(
        "P5 Send route cache-seeds wallets and capability types",
        "SEND_WALLETS_CACHE_KEY" in send
        and "SEND_CAPS_CACHE_KEY" in send
        and "cachedSendWallets" in send
        and "cachedSendCaps" in send,
        "SendMoneyFlow must seed wallets/capabilities from cache before refresh",
        failures,
    )

    # Notifications parity: background refresh should not blank cached list.
    check(
        "P6 Notifications keeps cached rows visible while refreshing",
        "const hasCachedRows = rowsRef.current.length > 0;" in notifications
        and "if (!hasCachedRows) setLoading(true);" in notifications,
        "NotificationsScreen load() must only set loading on cold start",
        failures,
    )

    # Team/external/profile are expected to remain cache-first patterns.
    check(
        "P7 Team remains cache-first without cold-start blocking",
        "cachedRoster" in team
        and "const [loading, setLoading]   = useState(false);" in team
        and "TEAM_LOAD_TIMEOUT_MS" not in team
        and "withTimeout(" not in team
        and "isRequestTimeout" in team,
        "TeamScreen must not block first paint behind an artificial timeout wrapper",
        failures,
    )

    check(
        "P8 External accounts remains cache-first",
        "cached.length === 0" in external and "no setLoading(true) here" in external,
        "ExternalAccountsScreen must preserve cache-first background refresh",
        failures,
    )

    check(
        "P9 Profile fast-paints from cache before network",
        "const [loading, setLoading] = useState(() =>" in profile
        and "!localStorage.getItem('borderpay_user')" in profile,
        "ProfileScreen should not force loading on warm cache",
        failures,
    )

    if failures:
        print(f"\nbusiness_performance_parity_phase2_audit: FAIL ({len(failures)} checks)")
        return 1
    print("\nbusiness_performance_parity_phase2_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

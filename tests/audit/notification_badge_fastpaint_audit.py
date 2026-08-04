#!/usr/bin/env python3
"""
Notification badge fast-paint audit.

Locks the AppShell notification badge contract:
  N1 MainApp hydrates unreadCount from a per-user local cache, not hardcoded 0.
  N2 Backend refresh writes the same cache through a single updater.
  N3 NotificationsScreen reports row changes back to MainApp so mark-read/delete
     actions update the shell badge immediately.
  N4 Cached notification rows are per-user, never global.
  N5 NotificationsScreen financial rows are sourced from the same transaction
     caches as Dashboard, Recent Activity, and Transactions.

Non-runtime: parses source as text. No deploy, DB, or network.

Run: python3 tests/audit/notification_badge_fastpaint_audit.py
"""

from __future__ import annotations
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def main() -> int:
    main_app = read("components/app/MainApp.tsx")
    notifications = read("components/notifications/NotificationsScreen.tsx")

    checks: list[tuple[str, bool, str]] = []

    checks.append((
        "N1 unread badge fast-paints from per-user cache",
        "function unreadCountCacheKey(userId: string): string" in main_app
        and "borderpay_unread_count:${userId}" in main_app
        and "readCachedUnreadCount(userId)" in main_app
        and "useState<number>(() => readCachedUnreadCount(userId))" in main_app
        and "useState<number>(0)" not in main_app,
        "MainApp unreadCount must initialize from a per-user cache, not from 0",
    ))

    checks.append((
        "N2 unread backend refresh updates cache",
        "const updateUnreadCount = useCallback((count: number)" in main_app
        and "writeCachedUnreadCount(userId, next)" in main_app
        and "backendAPI.financial.getSnapshot(20)" in main_app
        and "updateUnreadCount(n)" in main_app,
        "Backend unread refresh must update React state and local cache through updateUnreadCount",
    ))

    checks.append((
        "N3 notification screen actions update shell badge",
        "onUnreadCountChange?: (count: number) => void" in notifications
        and "onUnreadCountChange?.(unreadNotificationCount(data))" in notifications
        and notifications.count("onUnreadCountChange?.(") >= 4
        and "<NotificationsScreen onBack={navigateBack} onUnreadCountChange={updateUnreadCount} />" in main_app,
        "NotificationsScreen must publish unread changes back to MainApp for load, mark-read, mark-all-read, and delete",
    ))

    checks.append((
        "N4 notification rows cache is per-user",
        "NOTIFICATIONS_CACHE_PREFIX = 'borderpay_notifications_cache:'" in notifications
        and "currentNotificationCacheKey()" in notifications
        and "financialCacheKey(NOTIFICATIONS_CACHE_PREFIX, { userId: String(user.id) })" in notifications
        and "localStorage.setItem(key" in notifications
        and "borderpay_notifications_cache'" not in notifications,
        "Notification row cache must be keyed by user id, never a shared device-wide key",
    ))

    checks.append((
        "N5 notification inbox shares activity caches",
        "TX_CACHE_KEY = 'borderpay_tx_history_v1'" in notifications
        and "DASH_RECENT_TX_KEY = 'borderpay_dash_recent_tx_v1'" in notifications
        and "BIZ_DASH_TX_KEY = 'borderpay_business_dash_tx_v1'" in notifications
        and "readCachedActivityNotifications()" in notifications
        and "composeNotificationRows(readCachedNotifications(), readCachedActivityNotifications())" in notifications
        and "backendAPI.financial.getSnapshot(100)" in notifications
        and "__activity_source: 'transactions'" in notifications,
        "NotificationsScreen must first-paint from the same transaction/recent activity caches used by Dashboard and Transactions",
    ))

    print("notification_badge_fastpaint_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for _, p, _ in checks if p)}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

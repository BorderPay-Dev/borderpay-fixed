#!/usr/bin/env python3
"""Static, offline readiness audit for production business certification."""
from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def main() -> int:
    failures: list[str] = []
    dashboard = read("components/business/BusinessDashboard.tsx")
    treasury = read("components/business/TreasuryCard.tsx")
    wallet = read("components/wallet/WalletScreen.tsx")
    notifications = read("components/notifications/NotificationsScreen.tsx")
    team = read("components/team/TeamScreen.tsx")
    settings = read("components/settings/SettingsScreen.tsx")
    profile = read("components/profile/ProfileScreen.tsx")
    main_app = read("components/app/MainApp.tsx")
    backend = read("utils/api/backendAPI.ts")
    sync = read("supabase/functions/bridge-sync-accounts/index.ts")
    inactivity = read("utils/auth/useInactivityTimer.ts")
    session = read("utils/api/sessionAPI.ts")
    signup = read("supabase/functions/auth-signup/index.ts")
    onboarding_migration = read("supabase/migrations/20260814090000_tenant_onboarding_security.sql")
    origin_migration = read("supabase/migrations/20260816090000_account_origin_provenance.sql")

    checks = [
        ("Dashboard can schedule wallet reconciliation", "backendAPI.financial.getWalletRouteData()" in dashboard and "void bridgeAPI.syncAccounts()" in backend),
        ("Treasury reads canonical snapshot", "backendAPI.financial.getSnapshot(250)" in treasury),
        ("Wallet opening schedules account sync", "backendAPI.bridge.syncAccounts()" in wallet),
        ("Bridge sync writes local mirror tables", '.from("bridge_wallets").update' in sync and '.from("bridge_wallets").insert' in sync and '.from("bridge_virtual_accounts").update' in sync and '.from("bridge_virtual_accounts").insert' in sync),
        ("Notifications exposes mark/delete mutations", "backendAPI.notifications.markAsRead" in notifications and "backendAPI.notifications.markAllAsRead" in notifications and "backendAPI.notifications.deleteNotification" in notifications),
        ("Team exposes invite/remove mutations", "backendAPI.team.invite" in team and "backendAPI.team.remove" in team),
        ("Settings exposes account mutations", "suspendUser" in settings and "deleteCurrent" in settings),
        ("Business profile exposes update/upload mutations", "backendAPI.user.updateProfile" in profile and "backendAPI.user.uploadProfilePicture" in profile),
        ("All authenticated surfaces can emit activity POST", "sessionAPI.updateActivity()" in inactivity and "method: 'POST'" in session and "appState === 'dashboard' && isAuthenticated" in read("App.tsx")),
        ("Dashboard has genuine Individual component", "<Dashboard" in main_app and "<BusinessDashboard" in main_app),
        ("Team Individual route is non-equivalent placeholder", "Team management is for business accounts" in team),
        ("Treasury has no standalone Individual route", "<TreasuryCard" in dashboard and "TreasuryCard" not in read("components/app/Dashboard.tsx")),
        ("Business profile enrichment is account-type conditional", "profileData.account_type === 'business'" in profile and "backendAPI.business.getProfile" in profile),
        ("Mutable auth metadata is not the origin authority", 'onboarding_channel: "direct"' in signup and '.from("account_origin_provenance").insert' in signup),
        ("Partner audit schema has no direct channel", "onboarding_channel text not null check (onboarding_channel in ('api','white_label'))" in onboarding_migration),
        ("Immutable account origin distinguishes direct/partner/imported/migrated", "origin_kind in ('direct','partner','imported','migrated')" in origin_migration and "account_origin_provenance_immutable" in origin_migration),
        ("Direct/partner origin is written by authoritative signup", '.from("account_origin_provenance").insert' in signup and 'partnerAuthorization ? "partner" : "direct"' in signup),
        ("Browser cannot write account origin", "revoke all on table public.account_origin_provenance from public, anon, authenticated" in origin_migration),
    ]
    for name, passed in checks:
        print(f"[{'OK' if passed else 'FAIL'}] {name}")
        if not passed:
            failures.append(name)

    manual_verifier = read("scripts/ci/verify_manual_intervention_audit.py")
    external_verifier = read("scripts/ci/verify_external_audit_ledger.py")
    external_migration = read("supabase/migrations/20260822090000_certification_external_audit_ledger.sql")
    external_worker = read("supabase/functions/certification-audit-delivery/index.ts")
    manual_ready = (
        "supabase_postgres_pgaudit_export" in manual_verifier
        and "manual audit export SHA-256 mismatch" in manual_verifier
        and "borderpay_external_worm_audit_export_v1" in external_verifier
        and "external audit sequence gap" in external_verifier
        and "external audit receipt signature invalid" in external_verifier
        and "certification_audit_events" in external_migration
        and "verifySinkReceipt" in external_worker
    )
    print(f"[{'OK' if manual_ready else 'FAIL'}] manual_db_intervention accepts only verified pgaudit or signed external immutable exports")
    if not manual_ready:
        failures.append("manual intervention verifier")
    print("[INFO] Surface capture is not strictly read-only: session activity POST applies globally")

    if failures:
        print(f"\nrc1_business_certification_offline_readiness_audit: FAIL ({len(failures)} static checks)")
        return 1
    print("\nrc1_business_certification_offline_readiness_audit: PASS (static trace and external audit contract complete)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

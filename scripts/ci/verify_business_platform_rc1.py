#!/usr/bin/env python3
"""
Business platform RC1 convergence gate.

Fail release when business-critical surfaces drift from canonical contracts.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def must(name: str, cond: bool, fail: str, failures: list[str]) -> None:
    if cond:
        print(f"[OK] {name}")
    else:
        print(f"[FAIL] {name}: {fail}")
        failures.append(name)


def main() -> int:
    failures: list[str] = []

    main_app = read("components/app/MainApp.tsx")
    business_dashboard = read("components/business/BusinessDashboard.tsx")
    treasury_card = read("components/business/TreasuryCard.tsx")
    send_flow = read("components/send/SendMoneyFlow.tsx")
    send_capability_timeout = read("components/send/sendCapabilityTimeout.ts")
    receive = read("components/receive/ReceiveMoneyScreen.tsx")
    tx_screen = read("components/transactions/TransactionsScreen.tsx")
    notif = read("components/notifications/NotificationsScreen.tsx")
    team = read("components/team/TeamScreen.tsx")
    ext_accounts = read("components/payouts/ExternalAccountsScreen.tsx")
    bulk_payout = read("components/business/BulkPayoutScreen.tsx")
    identity = read("supabase/functions/_shared/bridge-identity-invariant.ts")
    worker = read("supabase/functions/process-pending-events/index.ts")

    # Route coverage for business flows.
    required_routes = [
        "send-money",
        "receive-money",
        "transactions",
        "notifications",
        "team",
        "bulk-payout",
        "external-accounts",
        "exchange",
    ]
    for route in required_routes:
        must(
            f"Route wired: {route}",
            route in main_app,
            f"missing route token {route}",
            failures,
        )

    # Canonical snapshot consumption on business financial UI.
    must(
        "Business dashboard uses canonical snapshot",
        "backendAPI.financial.getSnapshot" in business_dashboard,
        "BusinessDashboard must read financial.getSnapshot",
        failures,
    )
    must(
        "Business dashboard has no legacy wallet read",
        "backendAPI.wallets.getWallets" not in business_dashboard,
        "remove wallets.getWallets read path",
        failures,
    )
    treasury_reads_canonical = (
        "transactions?: any[]" in treasury_card
        or "backendAPI.transactions.getTransactions" in treasury_card
        or "backendAPI.financial.getTransactionsRouteData" in treasury_card
        or "backendAPI.financial.getSnapshot" in treasury_card
    )
    must(
        "Treasury card uses canonical transaction source",
        treasury_reads_canonical,
        "TreasuryCard must read transactions from canonical transaction APIs",
        failures,
    )

    canonical_contracts = [
        ("Send", send_flow, ["backendAPI.financial.getSendRouteData", "backendAPI.financial.getSnapshot"]),
        ("Receive", receive, ["backendAPI.financial.getReceiveRouteData", "backendAPI.financial.getSnapshot"]),
        ("Transactions", tx_screen, ["backendAPI.transactions.getTransactions", "backendAPI.financial.getTransactionsRouteData", "backendAPI.financial.getSnapshot"]),
        ("Notifications", notif, ["backendAPI.notifications.getNotifications", "backendAPI.financial.getNotificationsRouteData", "backendAPI.financial.getSnapshot"]),
        ("External accounts", ext_accounts, ["backendAPI.financial.getExternalAccountsRouteData", "backendAPI.financial.getSnapshot"]),
    ]
    for name, src, needles in canonical_contracts:
        must(
            f"{name} reads canonical route data",
            any(n in src for n in needles),
            f"{name} missing canonical route data call ({' | '.join(needles)})",
            failures,
        )

    # No perpetual-loading guardrails on major business screens.
    institutions_load_start = send_flow.find("const loadInstitutions = async () =>")
    institutions_load_end = send_flow.find("// Validate transfer limits", institutions_load_start)
    institutions_load = send_flow[
        institutions_load_start : institutions_load_end if institutions_load_end >= 0 else len(send_flow)
    ] if institutions_load_start >= 0 else ""
    timeout_call = institutions_load.find("await withSendCapabilityTimeout(")
    discovery_calls = [
        institutions_load.find("backendAPI.payouts.", 0),
        institutions_load.find("loadYellowCardCapability(", 0),
    ]
    discovery_call = min((position for position in discovery_calls if position >= 0), default=-1)
    capability_finally = institutions_load.find("finally", timeout_call)
    capability_loading_clear = institutions_load.find("setLoadingInstitutions(false)", capability_finally)
    send_timeout_guard = (
        discovery_call >= 0
        and timeout_call > discovery_call
        and capability_finally > timeout_call
        and capability_loading_clear > capability_finally
        and "SendCapabilityTimeoutError" in send_flow
        and "setInstitutionsLoadError" in send_flow
        and "Retry payout rails" in send_flow
        and "SEND_CAPABILITY_DISCOVERY_TIMEOUT_MS = 15_000" in send_capability_timeout
        and "Promise.race([operation, timeout])" in send_capability_timeout
        and "setTimeout(" in send_capability_timeout
        and "clearTimeout(" in send_capability_timeout
    )
    must(
        "Send capability timeout guard present",
        send_timeout_guard,
        "Send flow must hard-stop loading waits",
        failures,
    )
    for name, src in [
        ("Business dashboard", business_dashboard),
        ("Receive", receive),
        ("Transactions", tx_screen),
        ("Notifications", notif),
        ("Team", team),
        ("External accounts", ext_accounts),
        ("Bulk payout", bulk_payout),
    ]:
        has_loading = "setLoading(true)" in src or "setWalletsLoading(true)" in src
        has_finally = re.search(r"finally\s*\{[^}]*set[A-Za-z]*Loading\(false\)", src, re.S) is not None
        must(
            f"{name} loading terminates",
            (not has_loading) or has_finally,
            "loading state appears without finally false reset",
            failures,
        )

    # Operator account exclusion from lifecycle enforcement.
    identity_operator_guard = (
        ("operator_account_excluded" in identity and "operator_bridge_accounts" in identity)
        or ("operator_bridge_accounts" in worker)
    )
    must(
        "Identity invariant excludes operator accounts",
        identity_operator_guard,
        "bridge identity invariant missing operator exclusion",
        failures,
    )
    must(
        "Worker skips provisioning for operator accounts",
        "operator_bridge_accounts" in worker and "Skip auto-provisioning entirely" in worker,
        "process-pending-events missing operator provisioning skip",
        failures,
    )
    capture_pos = worker.find("const { data: operatorRow, error: operatorLookupError }")
    error_guard_pos = worker.find("if (operatorLookupError)", capture_pos)
    error_throw_pos = worker.find("operator_bridge_accounts lookup failed", error_guard_pos)
    operator_guard_pos = worker.find("if (operatorRow?.bridge_customer_id)", error_throw_pos)
    must(
        "Worker operator lookup fails closed",
        capture_pos >= 0
        and error_guard_pos > capture_pos
        and error_throw_pos > error_guard_pos
        and operator_guard_pos > error_throw_pos,
        "operator registry lookup errors must throw before the operator row check",
        failures,
    )

    if failures:
        print(f"\nverify_business_platform_rc1: FAIL ({len(failures)} checks)")
        return 1
    print("\nverify_business_platform_rc1: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

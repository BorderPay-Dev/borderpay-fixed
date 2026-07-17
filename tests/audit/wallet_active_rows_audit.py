#!/usr/bin/env python3
"""
Wallet active-row regression audit.

Production contract:
- WalletScreen shows only active USD/EUR/GBP virtual accounts and USDC/USDT wallets.
- WalletScreen must not render missing/unavailable account rows.
- AddWalletScreen is the only place that shows inactive or unavailable wallet options.
- Dashboard wallet chips keep centered balances; dashboard VA chips show no balance.
"""
from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WALLET = ROOT / "components/wallet/WalletScreen.tsx"
ADD_WALLET = ROOT / "components/wallet/AddWalletScreen.tsx"
DASHBOARD = ROOT / "components/app/Dashboard.tsx"
BUSINESS_DASHBOARD = ROOT / "components/business/BusinessDashboard.tsx"


def fail(message: str) -> None:
    print("FAIL: wallet active-row regression audit")
    print()
    print(message)
    sys.exit(1)


def require(text: str, needle: str, label: str) -> None:
    if needle not in text:
        fail(f"{label}: missing required marker: {needle}")


def reject(text: str, needle: str, label: str) -> None:
    if needle in text:
        fail(f"{label}: forbidden marker found: {needle}")


def block_between(text: str, start: str, end: str, label: str) -> str:
    start_idx = text.find(start)
    if start_idx < 0:
        fail(f"{label}: missing start marker: {start}")
    if not end:
        return text[start_idx:]
    end_idx = text.find(end, start_idx + len(start))
    if end_idx < 0:
        fail(f"{label}: missing end marker: {end}")
    return text[start_idx:end_idx]


def assert_wallet_screen(src: str) -> None:
    for marker in [
        "const SUPPORTED_STABLES = new Set(['USDC', 'USDT'])",
        "const SUPPORTED_VA = new Set(['USD', 'EUR', 'GBP'])",
        "const ACTIVE_WALLET_STATUSES",
        "const ACTIVE_VA_STATUSES",
        "function normalizeStableRows",
        "function normalizeVaRows",
        "function latestByCurrency",
        "return normalizeStableRows(scoped)",
        "return normalizeVaRows(scoped, readCachedCountry())",
        "const sList = normalizeStableRows(routeData?.data?.stablecoin_wallets)",
        "const vList = normalizeVaRows(routeData?.data?.virtual_accounts, country)",
    ]:
        require(src, marker, "WalletScreen")

    render_body = block_between(src, "{/* ── Balances list", "{/* Detail sheets */}", "WalletScreen render body")
    reject(render_body, "missingVa", "WalletScreen render body")
    reject(render_body, "missingStable", "WalletScreen render body")
    reject(render_body, "Open {c} account", "WalletScreen render body")
    reject(render_body, "Add {sym} wallet", "WalletScreen render body")
    reject(render_body, "Request {sym} deposit wallet", "WalletScreen render body")
    reject(render_body, "open one below", "WalletScreen empty copy")


def assert_add_wallet_screen(src: str) -> None:
    require(src, "const CARDS: WalletCard[] = [", "AddWalletScreen")
    require(src, "{ code: 'USD'", "AddWalletScreen")
    require(src, "{ code: 'EUR'", "AddWalletScreen")
    require(src, "{ code: 'GBP'", "AddWalletScreen")
    require(src, "{ code: 'USDC'", "AddWalletScreen")
    require(src, "{ code: 'USDT'", "AddWalletScreen")
    require(src, "{CARDS.map((card, idx) =>", "AddWalletScreen")
    require(src, "const ACTIVE_ROW_STATUSES", "AddWalletScreen")
    require(src, "function isActiveRow", "AddWalletScreen")
    require(src, "not available in your region", "AddWalletScreen")
    require(src, "Unavailable", "AddWalletScreen")
    require(src, "Active", "AddWalletScreen")
    require(src, "Deactivated", "AddWalletScreen")
    reject(src, "CARDS.filter((card)", "AddWalletScreen")


def assert_dashboard_chips(src: str, label: str, formatter: str) -> None:
    accounts = block_between(src, "spendableWallets.map((w)", "</button>", label)
    require(accounts, "min-h-[156px]", label)
    require(accounts, "text-center flex flex-col items-center justify-center", label)
    require(accounts, "text-[18px] font-bold", label)
    require(accounts, formatter, label)
    reject(accounts, "uppercase tracking-wider", label)
    va_accounts = block_between(src, "virtualAccounts.map((va)", "</button>", f"{label} VA cards")
    require(va_accounts, "onClick={() => setSelectedVa(va)}", f"{label} VA cards")
    require(va_accounts, "min-h-[156px]", f"{label} VA cards")
    require(va_accounts, "text-center flex flex-col items-center justify-center", f"{label} VA cards")
    reject(va_accounts, formatter, f"{label} VA cards")
    reject(va_accounts, "text-[18px] font-bold", f"{label} VA cards")


def main() -> int:
    for path in [WALLET, ADD_WALLET, DASHBOARD, BUSINESS_DASHBOARD]:
        if not path.is_file():
            fail(f"missing file: {path.relative_to(ROOT)}")

    assert_wallet_screen(WALLET.read_text())
    assert_add_wallet_screen(ADD_WALLET.read_text())
    assert_dashboard_chips(DASHBOARD.read_text(), "individual dashboard wallet chips", "formatDashboardWalletBalance(w)")
    assert_dashboard_chips(BUSINESS_DASHBOARD.read_text(), "business dashboard wallet chips", "formatBusinessWalletBalance(w)")

    print("PASS: wallet active-row regression audit")
    print()
    print("  wallet tab:      active supported rows only")
    print("  add-wallet tab:  unavailable options remain visible")
    print("  dashboard chips: centered wallet balances; no-balance VA account chips")
    return 0


if __name__ == "__main__":
    sys.exit(main())

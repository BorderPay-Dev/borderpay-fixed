#!/usr/bin/env python3
"""
Dashboard spendable wallet chip regression audit.

This protects the production dashboard contract:
- Accounts strips show positive spendable wallet balances only.
- Active virtual-account rows render as account chips without balances.
- Empty dashboard account CTAs navigate to add-wallet, not the wallet menu.
- Individual and business currency marks keep the large Wise-style treatment.

Usage:
  python3 tests/audit/dashboard_spendable_wallet_chips_audit.py
"""
from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = ROOT / "components/app/Dashboard.tsx"
BUSINESS_DASHBOARD = ROOT / "components/business/BusinessDashboard.tsx"


def fail(message: str) -> None:
    print("FAIL: dashboard spendable wallet chips audit")
    print()
    print(message)
    sys.exit(1)


def require(text: str, needle: str, label: str) -> None:
    if needle not in text:
        fail(f"{label}: missing required source marker: {needle}")


def block_between(text: str, start: str, end: str, label: str) -> str:
    start_idx = text.find(start)
    if start_idx < 0:
        fail(f"{label}: could not find start marker: {start}")
    if not end:
        return text[start_idx:]
    end_idx = text.find(end, start_idx + len(start))
    if end_idx < 0:
        fail(f"{label}: could not find end marker: {end}")
    return text[start_idx:end_idx]


def assert_individual_dashboard(src: str) -> None:
    require(src, "function isSpendableDashboardWallet", "individual dashboard")
    require(src, "function formatDashboardWalletBalance", "individual dashboard")
    require(src, "const spendableWallets = useMemo", "individual dashboard")
    require(src, "wallets.filter(isSpendableDashboardWallet)", "individual dashboard")
    require(src, ".filter(isSpendableDashboardWallet)", "individual dashboard snapshot loader")

    accounts = block_between(
        src,
        "{/* \u2500\u2500 ACCOUNTS",
        "{/* \u2500\u2500 BorderPay infrastructure",
        "individual accounts strip",
    )
    require(src, "const accountChipCount = spendableWallets.length + virtualAccounts.length", "individual dashboard")
    require(src, "AccountDetailSheet", "individual dashboard")
    require(accounts, "accountChipCount > 0", "individual accounts strip")
    require(accounts, "accountChipCount === 0", "individual accounts strip")
    require(accounts, "spendableWallets.map((w)", "individual accounts strip")
    require(accounts, "virtualAccounts.map((va)", "individual accounts strip")
    require(accounts, "onClick={() => setSelectedVa(va)}", "individual VA account chip")
    require(accounts, "formatDashboardWalletBalance(w)", "individual accounts strip")
    require(accounts, "handleNavigate('add-wallet')", "individual empty/add account CTA")

    if "wallets.map((w)" in accounts:
        fail("individual accounts strip: raw wallets.map((w) would render VA-only rows")
    if "handleNavigate('wallet-detail')" in block_between(
        accounts,
        "accountChipCount === 0",
        ") : (",
        "individual empty account CTA",
    ):
        fail("individual empty account CTA: must navigate to add-wallet, not wallet-detail")

    icon = block_between(src, "function DashboardCurrencyIcon", "// Major currency pairs", "DashboardCurrencyIcon")
    require(icon, "w-12 h-12", "DashboardCurrencyIcon")
    require(icon, "text-[30px]", "DashboardCurrencyIcon")
    require(icon, "w-10 h-10 object-contain", "DashboardCurrencyIcon")
    if "w-8 h-8 rounded-full" in icon:
        fail("DashboardCurrencyIcon: large account chip regressed to w-8 h-8")


def assert_business_dashboard(src: str) -> None:
    require(src, "function isSpendableBusinessWallet", "business dashboard")
    require(src, "function formatBusinessWalletBalance", "business dashboard")
    require(src, "const spendableWallets = useMemo", "business dashboard")
    require(src, "wallets.filter(isSpendableBusinessWallet)", "business dashboard")
    require(src, ".filter((w: WalletRow) => !!w.currency && isSpendableBusinessWallet(w))", "business wallet loader")

    accounts = block_between(
        src,
        "{/* \u2500\u2500 3. Accounts strip",
        "{/* \u2500\u2500 4. Quick actions",
        "business accounts strip",
    )
    require(src, "const accountChipCount = spendableWallets.length + virtualAccounts.length", "business dashboard")
    require(src, "AccountDetailSheet", "business dashboard")
    require(accounts, "accountChipCount > 0", "business accounts strip")
    require(accounts, "accountChipCount === 0", "business accounts strip")
    require(accounts, "spendableWallets.map((w)", "business accounts strip")
    require(accounts, "virtualAccounts.map((va)", "business accounts strip")
    require(accounts, "onClick={() => setSelectedVa(va)}", "business VA account chip")
    require(accounts, "formatBusinessWalletBalance(w)", "business accounts strip")
    require(accounts, "navigate('add-wallet')", "business empty/add account CTA")

    if "wallets.map((w)" in accounts:
        fail("business accounts strip: raw wallets.map((w) would render VA-only rows")
    if "navigate('wallet-detail')" in block_between(
        accounts,
        "accountChipCount === 0",
        ") : (",
        "business empty account CTA",
    ):
        fail("business empty account CTA: must navigate to add-wallet, not wallet-detail")

    icon = block_between(src, "function BizCurrencyIcon", "export default BusinessDashboard", "BizCurrencyIcon")
    require(icon, "w-12 h-12", "BizCurrencyIcon")
    require(icon, "text-[30px]", "BizCurrencyIcon")
    require(icon, "w-10 h-10 object-contain", "BizCurrencyIcon")
    if "w-8 h-8 rounded-full" in icon:
        fail("BizCurrencyIcon: large account chip regressed to w-8 h-8")


def assert_semantic_contract() -> None:
    sample_rows = [
        {"currency": "USD", "balance": 0, "bridge_virtual_account_id": "va_123"},
        {"currency": "EUR", "balance": 0, "bridge_virtual_account_id": "va_456"},
        {"currency": "USDC", "balance": 24.5},
        {"currency": "USDT", "balance": 0},
    ]
    spendable = [row for row in sample_rows if float(row.get("balance") or 0) > 0]
    if [row["currency"] for row in spendable] != ["USDC"]:
        fail("semantic contract: only positive spendable wallet balances should render as chips")
    virtual_account_cards = [
        row for row in sample_rows
        if row.get("bridge_virtual_account_id") and row["currency"] in ["USD", "EUR", "GBP"]
    ]
    if [row["currency"] for row in virtual_account_cards] != ["USD", "EUR"]:
        fail("semantic contract: active virtual accounts may render as no-balance account chips")


def main() -> int:
    if not DASHBOARD.is_file():
        fail(f"missing file: {DASHBOARD.relative_to(ROOT)}")
    if not BUSINESS_DASHBOARD.is_file():
        fail(f"missing file: {BUSINESS_DASHBOARD.relative_to(ROOT)}")

    assert_individual_dashboard(DASHBOARD.read_text())
    assert_business_dashboard(BUSINESS_DASHBOARD.read_text())
    assert_semantic_contract()

    print("PASS: dashboard spendable wallet chips audit")
    print()
    print("  individual dashboard: spendable wallet chips + no-balance VA chips")
    print("  business dashboard:   spendable wallet chips + no-balance VA chips")
    print("  empty account CTA:    add-wallet")
    print("  account chip mark:    large w-12 h-12 treatment")
    return 0


if __name__ == "__main__":
    sys.exit(main())

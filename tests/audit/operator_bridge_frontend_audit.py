#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = (ROOT / "App.tsx").read_text()
UI = (ROOT / "components/business/OperatorBridgeReadOnlyApp.tsx").read_text()
API = (ROOT / "utils/api/backendAPI.ts").read_text()

checks = {
    "exact founder identity selects the treasury frontend": (
        "founder@borderpayafrica.com" in APP
        and "b000f84b-5488-4a8a-b934-f669978c7e20" in APP
        and "<OperatorBridgeReadOnlyApp" in APP
    ),
    "treasury uses five top-level destinations": (
        "type TreasuryView = 'home' | 'wallets' | 'receive' | 'transactions' | 'send'" in UI
    ),
    "all five navigation labels are present": all(
        f"label: '{label}'" in UI for label in ("Home", "Wallet", "Accounts", "Transactions", "Send")
    ),
    "desktop navigation is responsive and persistent": (
        'aria-label="Treasury navigation"' in UI and "md:grid" in UI
    ),
    "mobile navigation is fixed and safe-area aware": (
        "fixed inset-x-0 bottom-0" in UI and "safe-area-inset-bottom" in UI and "md:hidden" in UI
    ),
    "active destination is announced accessibly": "aria-current={activeView === id ? 'page'" in UI,
    "navigation and actions meet minimum touch sizing": "min-h-11" in UI and "min-h-14" in UI,
    "each financial screen is explicitly selected": all(
        f"activeView === '{view}'" in UI for view in ("home", "wallets", "receive", "transactions", "send")
    ),
    "frontend reads and sends only through the dedicated API": (
        "backendAPI.bridge.operator.getSnapshot()" in UI
        and "backendAPI.bridge.operator.send(" in UI
        and "bridge-operator-readonly" in API
    ),
    "provider credentials never enter frontend code": "BRIDGE_API_KEY" not in UI and "Api-Key" not in UI,
    "an unavailable wallet balance is explicit and cannot be sent": "if (!wallet.balance_available) return null" in UI and "wallet.balance !== null" in UI,
    "send options come only from the server-filtered wallet snapshot": (
        "const sendSources" in UI and "snapshot?.wallets" in UI and "TREASURY_ASSETS" not in UI
    ),
    "treasury frontend never imports or invokes SCA": all(token not in UI for token in (
        "SCAChallengeDialog", "authorizeSCA", "getScaScope", "grantWalletAccess",
        "sca_authorization_id", "sca_attestation", "EEA SCA",
    )),
    "balance appears only on the Home portfolio": "Total balance" in UI and "Balances are intentionally consolidated on Home" in UI,
    "home total is USD spendable wallets only": all(token in UI for token in ("row.currency === 'USDC' || row.currency === 'USDT'", "formatMoney(usdTotal, 'USD')")) and "eurTotal" not in UI,
    "total balance is hidden by default": "useState(false)" in UI and "Hide treasury balance" in UI and "Show treasury balance" in UI,
    "home contains a real ledger-derived line chart": "TreasuryActivityChart" in UI and "Completed activity in USD" in UI and "transaction.status" in UI,
    "chart does not synthesize unsupported FX": "if (!['USD', 'USDC', 'USDT'].includes(value)) return null" in UI,
    "chart exposes requested treasury periods": all(token in UI for token in ("{ id: '1M', days: 30 }", "{ id: '3M', days: 90 }", "{ id: '6M', days: 180 }", "{ id: '1Y', days: 365 }")),
    "home action order is dashboard then quick actions then recent activity": UI.index("<TreasuryActivityChart") < UI.index("<QuickActions") < UI.index('id="recent-activity-title"'),
    "quick actions expose the four requested destinations": all(token in UI for token in ("Asset details", "Receiving rails", "Operations ledger", "Move funds")),
    "wallet screen omits wallet balances": "function WalletsView" in UI and "Deposit address" in UI,
    "receiving rails support US EU and GB": all(token in UI for token in ("'US'", "'EU'", "'GB'", "SEPA bank transfer", "Faster Payments", "ACH / Wire")),
    "receiving account list is provider-driven": ".map((account)" in UI and "ReceiveView" in UI,
    "customer ledger includes identity and transaction": "customer_name" in UI and "customer_email" in UI and "Customer transactions" in UI,
    "notification bell has accessible state": 'aria-label="Open treasury notifications"' in UI and "aria-expanded={notificationsOpen}" in UI,
    "mobile treasury scrollbars are hidden without disabling scroll": "bp-treasury-scroll" in UI and "scrollbar-width:none" in UI and "overflow-y-auto" in UI,
    "old information banner is removed": "Secure treasury workspace" not in UI,
    "home does not render per-wallet balance cards": "AssetBalanceChip" not in UI,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit("operator frontend audit failed: " + ", ".join(failed))
print(f"PASS: {len(checks)}/{len(checks)} operator frontend invariants")

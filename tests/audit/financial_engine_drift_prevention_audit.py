#!/usr/bin/env python3
"""
Deployment-blocking drift prevention audit.

Objective:
- Preserve one shared financial engine for individual + business accounts.
- Block any business-only fork of wallet/ledger/transaction/send/receive money
  execution primitives.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

CODE_DIRS = [
    ROOT / "components",
    ROOT / "utils",
    ROOT / "supabase" / "functions",
]

SQL_DIRS = [
    ROOT / "supabase" / "migrations",
    ROOT / "utils" / "supabase",
]

FORBIDDEN_BUSINESS_PREFIXES = [
    "BusinessWallet",
    "BusinessTransaction",
    "BusinessReceive",
    "BusinessSend",
    "BusinessNotification",
    "BusinessExternalAccount",
    "BusinessVirtualAccount",
    "BusinessStablecoin",
    "BusinessLedger",
    "BusinessBalance",
    "BusinessDeposit",
    "BusinessWithdrawal",
]

SHARED_FINANCIAL_SURFACES = [
    "components/app/Dashboard.tsx",
    "components/business/BusinessDashboard.tsx",
    "components/send/SendMoneyFlow.tsx",
    "components/receive/ReceiveMoneyScreen.tsx",
    "components/wallet/WalletScreen.tsx",
    "components/transactions/TransactionsScreen.tsx",
    "components/notifications/NotificationsScreen.tsx",
    "components/payouts/ExternalAccountsScreen.tsx",
    "components/wallets/ExternalWalletsScreen.tsx",
]

BUSINESS_ONLY_FILES = [
    "components/business/BusinessDashboard.tsx",
    "components/business/TreasuryCard.tsx",
    "components/business/PayrollScreen.tsx",
    "components/business/BulkPayoutScreen.tsx",
    "components/team/TeamScreen.tsx",
]

BANNED_BUSINESS_DIRECT_READS = [
    "backendAPI.wallets.getWallets",
    "backendAPI.transactions.getTransactions",
    ".from('bridge_wallets')",
    '.from("bridge_wallets")',
    ".from('bridge_virtual_accounts')",
    '.from("bridge_virtual_accounts")',
    ".from('bridge_virtual_account_balances')",
    '.from("bridge_virtual_account_balances")',
    ".from('bridge_transfers')",
    '.from("bridge_transfers")',
    ".from('bridge_balance_ledger')",
    '.from("bridge_balance_ledger")',
    ".from('transactions')",
    '.from("transactions")',
]

FINANCIAL_CACHE_TOKEN_RE = re.compile(r"financialCacheKey\(\s*['\"]([^'\"]+)['\"]")
DECL_TOKEN_RE_TEMPLATE = r"\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+({prefix}[A-Za-z0-9_]*)\b"


def iter_files(base: Path, suffixes: tuple[str, ...]) -> list[Path]:
    if not base.is_dir():
        return []
    out: list[Path] = []
    for p in base.rglob("*"):
        if p.is_file() and p.suffix in suffixes:
            out.append(p)
    return out


def rel(p: Path) -> str:
    return str(p.relative_to(ROOT))


def must(name: str, cond: bool, fail: str, failures: list[str]) -> None:
    if cond:
        print(f"[OK] {name}")
    else:
        print(f"[FAIL] {name}: {fail}")
        failures.append(name)


def main() -> int:
    failures: list[str] = []

    code_files: list[Path] = []
    for d in CODE_DIRS:
        code_files.extend(iter_files(d, (".ts", ".tsx", ".js", ".jsx")))
    engine_code_files = [
        path for path in code_files
        if "supabase/functions/_shared/email-templates/" not in rel(path)
    ]

    # 1) Block forbidden business financial implementation names.
    for prefix in FORBIDDEN_BUSINESS_PREFIXES:
        token_re = re.compile(DECL_TOKEN_RE_TEMPLATE.format(prefix=re.escape(prefix)))
        hits: list[str] = []
        for path in engine_code_files:
            txt = path.read_text(encoding="utf-8")
            for match in token_re.finditer(txt):
                hits.append(f"{rel(path)}::{match.group(1)}")
        must(
            f"No forbidden implementation prefix `{prefix}*`",
            not hits,
            "; ".join(hits[:8]),
            failures,
        )

    # 2) Shared surfaces must consume canonical financial snapshot.
    for file_rel in SHARED_FINANCIAL_SURFACES:
        src = (ROOT / file_rel).read_text(encoding="utf-8")
        must(
            f"{file_rel} uses financial.getSnapshot",
            "backendAPI.financial.getSnapshot" in src,
            "missing canonical snapshot read",
            failures,
        )

    # 3) Canonical resolvers must be used by snapshot API.
    backend_api = (ROOT / "utils/api/backendAPI.ts").read_text(encoding="utf-8")
    must(
        "backendAPI imports canonical ownership resolver",
        "from '../financial/ownership'" in backend_api and "ownerOrFilter" in backend_api,
        "backendAPI missing ownerOrFilter resolver import/usage",
        failures,
    )
    must(
        "backendAPI imports canonical wallet status resolver",
        "from '../financial/walletStatus'" in backend_api and "deriveWalletStatus" in backend_api,
        "backendAPI missing deriveWalletStatus resolver import/usage",
        failures,
    )
    must(
        "financial snapshot uses ownership + wallet status resolvers",
        "ownerOrFilter(user.id)" in backend_api and "deriveWalletStatus({" in backend_api,
        "getSnapshot must use canonical ownership + wallet status resolvers",
        failures,
    )

    # 4) Business-only UI components must not query wallet/ledger/tx tables/APIs directly.
    for file_rel in BUSINESS_ONLY_FILES:
        path = ROOT / file_rel
        if not path.is_file():
            continue
        src = path.read_text(encoding="utf-8")
        hits = [pat for pat in BANNED_BUSINESS_DIRECT_READS if pat in src]
        must(
            f"{file_rel} has no direct wallet/ledger/tx reads",
            not hits,
            f"banned direct reads: {', '.join(hits)}",
            failures,
        )

    # 5) Business compatibility caches may exist for fast paint, but they must
    # be populated only by the canonical confirmed snapshot publisher.
    publisher_start = backend_api.find("function publishConfirmedSnapshot")
    publisher_end = backend_api.find("function rememberSnapshot", publisher_start)
    publisher = backend_api[publisher_start:publisher_end]
    compatibility_keys = (
        "borderpay_business_dash_wallets_v1",
        "borderpay_business_dash_tx_v1",
    )
    must(
        "Business fast-paint caches are projections of the canonical snapshot",
        publisher_start >= 0 and all(key in publisher for key in compatibility_keys),
        "business cache keys must be written by publishConfirmedSnapshot",
        failures,
    )

    # 6) No separate business ledger tables or balance projections.
    sql_files: list[Path] = []
    for d in SQL_DIRS:
        sql_files.extend(iter_files(d, (".sql",)))
    table_re = re.compile(
        r"\b(?:create\s+table(?:\s+if\s+not\s+exists)?\s+)?"
        r"(business_(?:wallet|transaction|receive|send|notification|external_account|external_wallet|virtual_account|stablecoin|ledger|balance(?:_projection)?|deposit|withdrawal))\b",
        re.IGNORECASE,
    )
    sql_hits: list[str] = []
    for path in sql_files:
        txt = path.read_text(encoding="utf-8")
        for m in table_re.finditer(txt):
            sql_hits.append(f"{rel(path)}::{m.group(1)}")
    must(
        "No separate business financial ledger/projection tables",
        not sql_hits,
        "; ".join(sql_hits[:8]),
        failures,
    )

    # 7) No separate business Bridge integration layer in providers.
    providers_dir = ROOT / "supabase" / "functions" / "_shared" / "providers"
    provider_files = iter_files(providers_dir, (".ts", ".tsx", ".js"))
    provider_name_hits = [rel(p) for p in provider_files if "business" in p.name.lower()]
    provider_symbol_hits: list[str] = []
    provider_symbol_re = re.compile(r"\b(?:businessbridge|bridgebusiness)[A-Za-z0-9_]*\b", re.IGNORECASE)
    for path in provider_files:
        txt = path.read_text(encoding="utf-8")
        if provider_symbol_re.search(txt):
            provider_symbol_hits.append(rel(path))
    must(
        "No separate business Bridge integration layer",
        not provider_name_hits and not provider_symbol_hits,
        "; ".join((provider_name_hits + provider_symbol_hits)[:8]),
        failures,
    )

    if failures:
        print(f"\nfinancial_engine_drift_prevention_audit: FAIL ({len(failures)} checks)")
        return 1

    print("\nfinancial_engine_drift_prevention_audit: PASS")
    print(" - Shared financial surfaces stay on canonical snapshot + resolver path")
    print(" - Business-only financial engine forks are blocked")
    print(" - Business cache/table/provider drift guardrails are active")
    return 0


if __name__ == "__main__":
    sys.exit(main())

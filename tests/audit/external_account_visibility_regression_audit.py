#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
backend = (ROOT / "utils/api/backendAPI.ts").read_text()
send = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
accounts = (ROOT / "components/payouts/ExternalAccountsScreen.tsx").read_text()
edge = (ROOT / "supabase/functions/bridge-external-account/index.ts").read_text()
translations = (ROOT / "utils/i18n/translations.ts").read_text()

checks = {
    "Bridge account list has a bounded usable timeout": "EXTERNAL_ACCOUNT_LIST_TIMEOUT_MS = 10_000" in backend,
    "account-list failure is not reported as an empty successful list": "external_accounts_partial: !externalListRes?.success" in backend and "external_accounts_error:" in backend,
    "cached accounts are not overwritten by a failed refresh": "if (externalAccountsComplete)" in send and "setExternalAccounts(ext)" in send,
    "Send displays loading instead of a false empty state": "externalAccountsLoading && externalAccounts.length === 0" in send and "Loading payout accounts" in send,
    "Send displays a retryable lookup failure": "Retry payout accounts" in send and "setSendRouteReload" in send,
    "External Accounts displays first-load progress": "loading && rows.length === 0" in accounts and "Loading payout accounts" in accounts,
    "External Accounts does not suppress timeout errors": "isRequestTimeout" not in accounts,
    "Bridge listing requests the maximum documented page": 'query:  { limit: 100 }' in edge,
    "obsolete US-only payout title is absent": "US Payment Details" not in translations and "Paiement US (ACH/Wire)" not in translations,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"[{'PASS' if ok else 'FAIL'}] {name}")
if failed:
    raise SystemExit(1)
print("external_account_visibility_regression_audit: PASS")

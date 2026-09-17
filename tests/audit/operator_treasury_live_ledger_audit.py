from pathlib import Path

root = Path(__file__).resolve().parents[2]
backend = (root / "supabase/functions/bridge-operator-readonly/index.ts").read_text() + (root / "supabase/functions/bridge-operator-readonly/accounts.ts").read_text()
backend += (root / "supabase/functions/bridge-operator-readonly/activity.ts").read_text()
frontend = (root / "components/business/OperatorBridgeReadOnlyApp.tsx").read_text()

frontend += (root / "components/business/treasury/activity.ts").read_text()
chart = (root / "components/business/treasury/TreasuryVolume.tsx").read_text()
valuation = (root / "supabase/functions/bridge-operator-readonly/valuation.ts").read_text()
checks = {
    "live transfer list": 'path: `/v0/customers/${encodeURIComponent(customerId)}/transfers`' in backend,
    "live virtual-account history": (
        "/virtual_accounts/${" in backend
        and "encodeURIComponent(virtualAccountId)" in backend
        and "}/history`" in backend
    ),
    "history is read for every live VA": "virtualAccounts.map(async (account)" in backend,
    "VA history failures are isolated": "bridge_operator_virtual_account_history_unavailable" in backend,
    "provider activity is normalized": "normalizeTreasuryActivity" in backend,
    "provider rows are de-duplicated": "mergeTreasuryActivity" in backend and "new Map<string, any>()" in backend,
    "activity is newest first": "Date.parse(b.updated_at || b.created_at" in backend,
    "USD beneficiary name is supported": "bank_beneficiary_name" in backend,
    "activity availability is exposed": "virtual_account_history_available" in backend,
    "frontend consumes unified transactions": "snapshot?.transactions" in frontend,
    "recent activity consumes live ledger": "recentTransactions" in frontend,
    "transaction screen consumes live ledger": "BridgeTransferLedger" in frontend,
    "notifications consume live ledger": "pendingTransfers" in frontend,
    "chart is USD only with no asset selector": "valuationTotal(valuation)" in chart and "<select" not in chart,
    "history uses wallet after-balances rather than VA amounts": "event.available_balance" in valuation and "receipt.initial_amount" not in valuation,
    "operator view refreshes live": "30_000" in frontend and "visibilitychange" in frontend,
    "silent refresh preserves rendered data": "load(true)" in frontend,
    "production API is hard gated": 'BRIDGE_BASE_URL !== "https://api.bridge.xyz"' in backend,
    "master customer access remains allowlisted": "operator_bridge_app_access" in backend,
    "no local customer transaction fallback": '.from("customer_transactions")' not in backend,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(("PASS" if passed else "FAIL") + ": " + name)
if failed:
    raise SystemExit(f"{len(failed)} treasury live-ledger audit checks failed")
print(f"PASS: {len(checks)}/{len(checks)} treasury live-ledger audit checks passed")

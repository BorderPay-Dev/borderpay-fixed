from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = (ROOT / "utils/api/backendAPI.ts").read_text()
MAIN = (ROOT / "components/app/MainApp.tsx").read_text()
SEND = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
DASHBOARD = (ROOT / "components/app/Dashboard.tsx").read_text()
BUSINESS = (ROOT / "components/business/BusinessDashboard.tsx").read_text()
MIGRATION = (ROOT / "supabase/migrations/20260804133000_publish_financial_projection_realtime.sql").read_text()

failures = []

for token in [
    "function publishConfirmedSnapshot",
    "borderpay_dash_wallets_v1",
    "borderpay_business_dash_wallets_v1",
    "borderpay_wallets_v1",
    "borderpay_tx_history_v1",
    "borderpay_dash_recent_tx_v1",
    "borderpay_business_dash_tx_v1",
    "borderpay_notifications_cache:",
    "borderpay_wallet_balances_",
    "borderpay_wallet_total_",
    "async refreshForUser",
    "async refreshAfterMutation",
]:
    if token not in BACKEND:
        failures.append(f"canonical snapshot publisher missing: {token}")

if ".filter((row: any) => ['USDC', 'USDT'].includes" not in BACKEND:
    failures.append("snapshot wallets are not explicitly restricted to Bridge USDC/USDT custodial currencies")
if "void backendAPI.financial.refreshAfterMutation(userId, 100);" not in SEND:
    failures.append("successful send does not start confirmed projection refresh")

for token in [
    "table: 'bridge_balance_ledger', filter: `user_id=eq.${userId}`",
    "table: 'bridge_balance_ledger', filter: `business_user_id=eq.${userId}`",
    "table: 'transactions', filter: `user_id=eq.${userId}`",
    "table: 'notifications', filter: `user_id=eq.${userId}`",
    "borderpay:financial-snapshot",
]:
    if token not in MAIN:
        failures.append(f"individual/business realtime coverage missing: {token}")

for table in ["bridge_balance_ledger", "transactions", "notifications"]:
    if f"'{table}'" not in MIGRATION:
        failures.append(f"realtime publication migration missing {table}")

individual_actions = DASHBOARD[DASHBOARD.find("Circular action buttons"):DASHBOARD.find("Setup checklist")]
if "action.exchange" in individual_actions or "handleNavigate('exchange')" in individual_actions:
    failures.append("individual Quick Actions still expose Exchange")

business_actions = BUSINESS[BUSINESS.find("Quick actions"):BUSINESS.find("Treasury management")]
if 'label="FX"' in business_actions or "navigate('exchange')" in business_actions:
    failures.append("business Quick Actions still expose Exchange")

if failures:
    print("financial_projection_realtime_audit: FAIL")
    for failure in failures:
        print(f"- {failure}")
    raise SystemExit(1)

print("financial_projection_realtime_audit: PASS")

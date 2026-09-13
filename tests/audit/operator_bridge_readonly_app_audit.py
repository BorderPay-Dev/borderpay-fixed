#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (ROOT / "supabase/migrations/20260912170000_operator_bridge_readonly_access.sql").read_text()
WORKER = (ROOT / "supabase/functions/bridge-operator-readonly/index.ts").read_text()
APP = (ROOT / "App.tsx").read_text()
UI = (ROOT / "components/business/OperatorBridgeReadOnlyApp.tsx").read_text()
API = (ROOT / "utils/api/backendAPI.ts").read_text()
CONFIG = (ROOT / "supabase/config.toml").read_text()

checks = {
    "dedicated operator access registry": "operator_bridge_app_access" in MIGRATION,
    "master account is explicitly mapped": "founder@borderpayafrica.com" in MIGRATION and "de412f3c-53c3-4d4a-987e-09d17c9cd7e2" in MIGRATION,
    "access remains read only": "check (access_mode = 'read_only')" in MIGRATION and 'access.access_mode !== "read_only"' in WORKER,
    "money movement requires per-operator grant": "can_transfer boolean not null default false" in MIGRATION and "access.can_transfer !== true" in WORKER,
    "customer activity identity lookup is read only": '.from("user_profiles").select(' in WORKER and '.from("business_profiles").select(' in WORKER,
    "confirmed auth identity required": "email_confirmed_at" in WORKER and "db.auth.getUser(token)" in WORKER,
    "customer id is server selected": 'body?.bridge_customer_id' not in WORKER and '.eq("auth_email", email)' in WORKER,
    "operator registry rechecked": 'from("operator_bridge_accounts")' in WORKER and '.eq("active", true)' in WORKER,
    "Bridge API key never reaches UI": "BRIDGE_API_KEY" not in UI and "Api-Key" not in UI and "BRIDGE_API_KEY" not in APP,
    "read paths use provider GET": 'method: "GET"' in WORKER,
    "wallet balances are read": "getWalletBalances" in WORKER,
    "treasury exposes only USDC Base, EURC Base, and USDT Tron": all(token in WORKER for token in (
        '{ currency: "USDC", chain: "base" }',
        '{ currency: "EURC", chain: "base" }',
        '{ currency: "USDT", chain: "tron" }',
        "selectedWallets",
        "unsupported_treasury_asset",
    )),
    "duplicate Base balance reads are coalesced": "balanceRequests" in WORKER and "balancesFor" in WORKER,
    "one unavailable wallet balance cannot hide the whole treasury": "bridge_operator_wallet_balance_unavailable" in WORKER and "balance_available" in WORKER,
    "virtual accounts are read": "listVirtualAccounts" in WORKER,
    "transactions are read": 'path: "/v0/transfers"' in WORKER,
    "one-year customer transaction ledger is bounded": '.from("transactions")' in WORKER and '.limit(1000)' in WORKER and "customer_transactions" in WORKER,
    "treasury notifications are bounded": '.from("notifications")' in WORKER and '.limit(30)' in WORKER and "platform_activity_available" in WORKER,
    "provider payload is projected": "virtualAccountRow" in WORKER and "raw:" not in WORKER,
    "reads are audited": "operator_bridge_read_audit" in WORKER and "operator_bridge_read_audit" in MIGRATION,
    "response cannot be cached": '"Cache-Control": "no-store"' in WORKER,
    "function requires platform JWT": "[functions.bridge-operator-readonly]" in CONFIG and "verify_jwt = true" in CONFIG.split("[functions.bridge-operator-readonly]", 1)[1].split("[", 1)[0],
    "frontend uses dedicated endpoint": "bridge-operator-readonly" in API,
    "founder routes outside customer app": "OperatorBridgeReadOnlyApp" in APP and "founder@borderpayafrica.com" in APP,
    "money movement is dedicated": "operator_bridge_transfer_intents" in WORKER and "OPERATOR_BRIDGE_TRANSFERS_ENABLED" in WORKER,
    "server verifies transaction PIN": "verifyTransactionPin" in WORKER and "/functions/v1/verify-pin" in WORKER,
    "source wallet ownership verified": "wallet_not_owned" in WORKER and "sourceWalletId" in WORKER,
    "provider balance checked": "getWalletBalances" in WORKER and "insufficient_balance" in WORKER,
    "idempotent transfer claim": "idempotency_conflict" in WORKER and "operator_bridge_transfer_intents" in MIGRATION,
    "US operator transfer has no SCA attestation": "sca_attestation" not in WORKER and "verify-2fa" not in WORKER,
    "treasury UI has no SCA integration": all(token not in UI for token in (
        "SCAChallengeDialog", "authorizeSCA", "getScaScope", "grantWalletAccess",
        "sca_authorization_id", "sca_attestation", "EEA SCA",
    )),
    "treasury worker has no SCA integration": all(token not in WORKER for token in (
        "sca-scope", "sca-authorize", "sca-wallet-access", "consumeScaAuthorization",
        "sca_authorization_id", "sca_attestation", "verify-2fa",
    )),
    "read-only data and explicit send are separated": "Send from treasury" in UI and "operator_bridge_transfer_intents" in WORKER,
    "unavailable wallet balances are never displayed as zero": "if (!wallet.balance_available) return null" in UI and "wallet.balance !== null" in UI,
    "master treasury is isolated from customer UI": "BorderPay Africa Treasury" in UI and "<OperatorBridgeReadOnlyApp" in APP,
    "receiving rails are dynamically rendered": ".map((account)" in UI and "ReceiveView" in UI and "RailMark" in UI,
    "operator home uses ledger data for its chart": "TreasuryActivityChart" in UI and "customer_transactions" in WORKER,
    "operator total balance is privacy protected": "balanceVisible" in UI and "aria-pressed={balanceVisible}" in UI,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit("operator read-only audit failed: " + ", ".join(failed))
print(f"PASS: {len(checks)}/{len(checks)} operator read-only invariants")

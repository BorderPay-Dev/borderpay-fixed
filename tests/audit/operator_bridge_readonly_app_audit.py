#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (ROOT / "supabase/migrations/20260912170000_operator_bridge_readonly_access.sql").read_text()
WORKER = (ROOT / "supabase/functions/bridge-operator-readonly/index.ts").read_text()
PROVIDER = (ROOT / "supabase/functions/_shared/providers/bridge.ts").read_text()
APP = (ROOT / "App.tsx").read_text()
UI = (ROOT / "components/business/OperatorBridgeReadOnlyApp.tsx").read_text() + (ROOT / "components/business/treasury/values.ts").read_text()
API = (ROOT / "utils/api/backendAPI.ts").read_text()
CONFIG = (ROOT / "supabase/config.toml").read_text()

checks = {
    "dedicated operator access registry": "operator_bridge_app_access" in MIGRATION,
    "master account is explicitly mapped": "founder@borderpayafrica.com" in MIGRATION and "de412f3c-53c3-4d4a-987e-09d17c9cd7e2" in MIGRATION,
    "access remains read only": "check (access_mode = 'read_only')" in MIGRATION and 'access.access_mode !== "read_only"' in WORKER,
    "money movement requires per-operator grant": "can_transfer boolean not null default false" in MIGRATION and "access.can_transfer !== true" in WORKER,
    "master treasury excludes the customer transaction ledger": 'customer_transactions:' not in WORKER,
    "confirmed auth identity required": "email_confirmed_at" in WORKER and "db.auth.getUser(token)" in WORKER,
    "customer id is server selected": 'body?.bridge_customer_id' not in WORKER and '.eq("auth_email", email)' in WORKER,
    "operator registry rechecked": 'from("operator_bridge_accounts")' in WORKER and '.eq("active", true)' in WORKER,
    "Bridge API key never reaches UI": "BRIDGE_API_KEY" not in UI and "Api-Key" not in UI and "BRIDGE_API_KEY" not in APP,
    "read paths use provider GET": 'method: "GET"' in WORKER,
    "wallet balances are read": "getWalletBalances" in WORKER,
    "wallet balances use the documented production wallet resource": (
        '/wallets/${encodeURIComponent(walletId)}`' in PROVIDER
        and '/wallets/${encodeURIComponent(walletId)}/balances' not in PROVIDER
        and 'payload?.balances' in PROVIDER
    ),
    "treasury exposes only USDC Base, EURC Base, and USDT Tron": all(token in WORKER for token in (
        '{ currency: "USDC", chain: "base" }',
        '{ currency: "EURC", chain: "base" }',
        '{ currency: "USDT", chain: "tron" }',
        "selectedWallets",
        "unsupported_treasury_asset",
    )),
    "duplicate Base balance reads are coalesced": "balanceRequests" in WORKER and "balancesFor" in WORKER,
    "master Base wallet is pinned to the VA settlement address": all(token in WORKER for token in (
        'TREASURY_CANONICAL_BASE_ADDRESS',
        '0x00287b1e51e21c2f593f654b17c4b22c6e67399f',
        'text(wallet.address).toLowerCase() === TREASURY_CANONICAL_BASE_ADDRESS',
        'eligibleMatches[0]',
        'noncanonical_treasury_wallet',
    )),
    "one unavailable wallet balance cannot hide the whole treasury": "bridge_operator_wallet_balance_unavailable" in WORKER and "balance_available" in WORKER,
    "virtual accounts are read": "listVirtualAccounts" in WORKER,
    "external bank accounts are live-read and fail soft in the snapshot": all(token in WORKER for token in (
        "listExternalAccounts(customerId)",
        "external_accounts_available",
        "bridge_operator_external_accounts_unavailable",
    )),
    "fiat send revalidates external-account ownership server-side": all(token in WORKER for token in (
        "destination_external_account_id",
        "external_account_not_owned",
        "unsupported_external_account",
        "external_account_currency_mismatch",
        "external_account_id: fiatDestination.id",
    )),
    "treasury send UI supports wallet and verified bank destinations": all(token in UI for token in (
        "External bank account",
        "Verified external account",
        "externalAccountsAvailable",
        "destination_external_account_id",
    )),
    "transactions are read": 'path: "/v0/transfers"' in WORKER,
    "snapshot declares its live production source": 'source: "bridge_production_live"' in WORKER,
    "operator treasury rejects non-production provider configuration": (
        'BRIDGE_BASE_URL !== "https://api.bridge.xyz"' in WORKER
        and "bridge_operator_nonproduction_base_url" in WORKER
    ),
    "master-account transfers are visible in treasury": "BridgeTransferLedger" in UI and "snapshot.transactions" in UI,
    "production reads fail soft by resource": all(token in WORKER for token in ("profileResult", "walletResult", "virtualAccountResult", "transferResult", "transfers_available")),
    "provider payload is projected": "virtualAccountRows" in WORKER and "raw:" not in WORKER,
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
    "operator home uses the master transfer ledger for its chart": "TreasuryActivityChart transactions={snapshot.transactions}" in UI,
    "operator total balance is privacy protected": "balanceVisible" in UI and "aria-pressed={balanceVisible}" in UI,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit("operator read-only audit failed: " + ", ".join(failed))
print(f"PASS: {len(checks)}/{len(checks)} operator read-only invariants")

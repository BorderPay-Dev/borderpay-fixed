#!/usr/bin/env python3
"""Protect user-requested wallet/VA creation; approval-webhook wallets remain automatic."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


helper = read("supabase/functions/_shared/wallet-security-enrollment.ts")
for field in (
    "pin_set",
    "pin_hash_v2",
    "pin_hash",
    "two_factor_enabled",
    "two_factor_secret_encrypted",
):
    require(field in helper, f"security enrollment must verify {field}")
require("transaction_pin" in helper and "authenticator" in helper, "response must identify both required factors")
require("bridgeProvider.getCustomerProfile" in helper, "enrollment scope must use Bridge customer country")
require("isBridgeEeaScaCountry" in helper, "enrollment must be restricted to the EEA-30")
require("bridgeEeaWalletSecurityRequired(country)" in helper, "Bridge country must control the EEA enrollment gate")
require("required: false" in helper, "non-EEA customers must bypass the enrollment requirement")

creation_paths = {
    "supabase/functions/bridge-wallet/index.ts": "bridgeProvider.createWallet(",
    "supabase/functions/bridge-provision-stablecoins/index.ts": "bridgeProvider.createWallet(",
    "supabase/functions/bridge-virtual-account/index.ts": "bridgeProvider.createVirtualAccount(",
}
for path, create_call in creation_paths.items():
    source = read(path)
    require("loadBridgeEeaWalletSecurityEnrollment" in source, f"{path} missing EEA-scoped server enrollment gate")
    require("bridgeEeaScaEnforcementEnabled" in source, f"{path} must remain behavior-neutral before controlled activation")
    create_count = source.count(create_call)
    gate_count = source.count("loadBridgeEeaWalletSecurityEnrollment(")
    require(gate_count >= create_count, f"{path} has an ungated provider creation branch")
    gate = source.find("loadBridgeEeaWalletSecurityEnrollment")
    # Ignore the import and find the first invocation.
    gate = source.find("loadBridgeEeaWalletSecurityEnrollment(", gate + len("loadBridgeEeaWalletSecurityEnrollment"))
    require(gate >= 0, f"{path} never invokes the enrollment gate")
    require(gate < source.find(create_call), f"{path} gates only after provider creation")

worker = read("supabase/functions/process-pending-events/index.ts")
require('normalized === "approved"' in worker, "wallet provisioning must follow an approved Bridge webhook")
require("ensureStablecoinWalletsProvisioned" in worker, "approved non-EEA Bridge webhooks must provision wallets automatically")
require('if (isBridgeEeaCountry(country))' in worker, "EEA approval must defer wallet creation")
require('bridge_eea_wallet_auto_provision_skipped' in worker, "EEA manual-wallet decision must be observable")

screen = read("components/wallet/AddWalletScreen.tsx")
require("getSecurityStatus" not in screen, "wallet UI must not apply the EEA enrollment rule globally")
require("security_enrollment_required" in screen, "wallet UI must follow the server-scoped enrollment decision")
require("onNavigate?.('pin-setup')" in screen, "wallet UI must start with PIN setup")
require("onNavigate?.('two-factor-setup')" in screen, "wallet UI must continue to authenticator setup")

dashboard_wallets = read("components/dashboard/bridge/BridgeWalletsCard.tsx")
require("provisionStablecoins()" not in dashboard_wallets, "dashboard refresh must not auto-create wallets")

scope = read("supabase/functions/_shared/bridge-sca-scope.ts")
require("isActiveBridgeCustodialWallet" in scope, "SCA scope must distinguish active wallets")
require('reason: "no_custodial_wallet"' in scope, "users without active wallets must remain outside SCA")
for terminal in ("closed", "deleted", "disabled", "deactivated", "inactive"):
    require(f'"{terminal}"' in scope, f"terminal wallet status {terminal} must not activate SCA")

print("wallet security enrollment audit passed")

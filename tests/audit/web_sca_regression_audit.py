#!/usr/bin/env python3
"""Regression gate for Bridge-scoped EEA SCA."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    path = ROOT / relative
    if not path.is_file():
        raise AssertionError(f"missing required file: {relative}")
    return path.read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


scope = read("supabase/functions/_shared/bridge-sca-scope.ts")
country_list = scope.split("const EEA_ISO3_TO_ISO2", 1)[0]
for code in ("AT", "FR", "DE", "IS", "LI", "NO"):
    require(f'"{code}"' in country_list, f"EEA SCA country list missing {code}")
for code in ("GB", "CH"):
    require(f'"{code}"' not in country_list, f"{code} must not be in EEA SCA scope")
require("loadAndAssertBridgeIdentityInvariant" in scope, "SCA scope must use authoritative identity invariant")
require("bridgeProvider.getCustomerProfile" in scope, "SCA scope must query Bridge customer country")
require("bridgeProvider.listWallets" in scope, "SCA scope must verify a custodial wallet")
require("isActiveBridgeCustodialWallet" in scope, "SCA scope must require an active custodial wallet")
require('reason: "no_custodial_wallet"' in scope, "no active wallet must remain outside SCA")
require('verificationStatus === "approved"' in scope, "SCA must require verified KYC/KYB")

scope_endpoint = read("supabase/functions/sca-scope/index.ts")
require("resolveBridgeScaScope(supabase, user.id)" in scope_endpoint, "scope endpoint must derive authenticated user server-side")
require("req.json()" not in scope_endpoint, "scope endpoint must not accept browser country/scope")
require("isBridgeEeaScaCountry(scope.country)" in scope_endpoint, "security enrollment must be limited to authoritative EEA scope")
require("security_enrollment_required" in scope_endpoint, "EEA sensitive-screen enrollment state missing")

authorize = read("supabase/functions/sca-authorize/index.ts")
require(authorize.index("resolveBridgeScaScope") < authorize.index('verifyFactor("verify-pin"'), "scope must resolve before factors")
require('verified_factors: ["pin", "totp"]' in authorize, "SCA must use transaction PIN plus TOTP")
require('verifyFactor("verify-pin"' in authorize, "knowledge factor must use the server PIN verifier")
require('const totpResult = pinResult.ok' in authorize, "TOTP must only be consumed after the PIN succeeds")
require("signInWithPassword" not in authorize, "account password must not replace the accepted transaction-PIN factor")
require("scaPayloadHash(resource, body.request)" in authorize, "SCA must bind exact action payload")
require("bridgeEeaScaEnforcementEnabled" in authorize, "Bridge approval rollout switch required")
require(authorize.index("bridgeEeaScaEnforcementEnabled") < authorize.index("resolveBridgeScaScope(supabase, user.id)"), "disabled rollout must bypass provider scope before any customer restriction")
require("enforcement_enabled: false" in scope_endpoint, "disabled rollout must be explicit to the client")

main = read("components/app/MainApp.tsx")
protected_block = main.split("const BRIDGE_SCA_ACCOUNT_ACCESS_SCREENS", 1)[1].split("]);", 1)[0]
for protected in ("'dashboard'", "'home'", "'wallet-detail'", "'transactions'"):
    require(protected in protected_block, f"account-access gate missing {protected}")
for excluded in ("'receive-money'", "'kyc'", "'profile'", "'settings'"):
    require(excluded not in protected_block, f"non-sensitive screen incorrectly gated: {excluded}")
require("getScaScope()" in main, "app must obtain server-authoritative scope")
require("scaMissingSecurityFactors" in main, "sensitive screens must enforce EEA PIN/TOTP enrollment")
require("setCurrentScreen('two-factor-setup')" in main, "PIN setup must advance to authenticator setup")
require("No balance or transaction data was displayed" in main, "unknown scope must fail closed for financial reads")

login = read("components/auth/LoginScreen.tsx")
for banned in ("SCAChallengeDialog", "authorizeSCA", "getScaScope", "grantWalletAccess"):
    require(banned not in login, f"login must never be blocked by Bridge SCA: {banned}")
require(login.count("backendAPI.auth.getSecurityStatus(") >= 2, "login must retain authoritative 2FA status")
require("TOTPManager.isEnabled" not in login, "browser TOTP cache must not block login")

send = read("components/send/SendMoneyFlow.tsx")
require("buildPaymentScaContext" in send, "payment SCA must bind the exact provider request")
require("resource: 'bridge_transfer'" in send, "Bridge payment SCA resource missing")
require("resource: 'yellowcard_jit_payout'" in send, "Yellow Card JIT payment SCA resource missing")
require("bridgeScaScope === 'required'" in send, "payment SCA must be EEA-scoped")
require("backendAPI.auth.verifyPIN(pin)" in send, "non-EEA transfer must retain server PIN")

sensitive_surfaces = {
    "components/payouts/AddExternalAccountScreen.tsx": (
        "beneficiary_change", "bridge_external_account", "action: 'create'",
    ),
    "components/payouts/ExternalAccountsScreen.tsx": (
        "beneficiary_change", "bridge_external_account", "action: 'delete'",
    ),
    "components/wallets/ExternalWalletsScreen.tsx": (
        "beneficiary_change", "external_wallet", "action: 'add'", "action: 'remove'",
    ),
    "components/settings/ChangePassword.tsx": (
        "security_change", "change_password", "action: 'change_password'",
    ),
    "components/settings/ChangePIN.tsx": (
        "security_change", "change_pin", "action: 'change_pin'",
    ),
    "components/security/TwoFactorSetup.tsx": (
        "security_change", "disable_2fa", "action: 'disable_2fa'",
    ),
    "components/security/BiometricSetup.tsx": (
        "security_change", "biometric_change", "enable_biometric", "disable_biometric",
    ),
}
for path, markers in sensitive_surfaces.items():
    source = read(path)
    require("useBridgeScaAction" in source, f"sensitive screen lacks Bridge scope gate: {path}")
    require("scaChallenge" in source, f"sensitive screen lacks SCA challenge: {path}")
    for marker in markers:
        require(marker in source, f"sensitive screen {path} missing exact binding marker {marker}")

protected_backends = {
    "supabase/functions/bridge-external-account/index.ts": (
        "beneficiary_change", "bridge_external_account", "sca_authorization_id",
    ),
    "supabase/functions/external-wallet/index.ts": (
        "beneficiary_change", "external_wallet", "sca_authorization_id",
    ),
    "supabase/functions/change-password/index.ts": (
        "security_change", "change_password", "sca_authorization_id",
    ),
    "supabase/functions/change-pin/index.ts": (
        "security_change", "change_pin", "sca_authorization_id",
    ),
    "supabase/functions/disable-2fa/index.ts": (
        "security_change", "disable_2fa", "sca_authorization_id",
    ),
    "supabase/functions/webauthn-register-verify/index.ts": (
        "security_change", "biometric_change", "enable_biometric",
    ),
    "supabase/functions/webauthn-delete/index.ts": (
        "security_change", "biometric_change", "disable_biometric",
    ),
}
for path, markers in protected_backends.items():
    source = read(path)
    require("consumeScaAuthorization" in source, f"protected backend does not consume SCA: {path}")
    for marker in markers:
        require(marker in source, f"protected backend {path} missing exact binding marker {marker}")

helper = read("utils/security/useBridgeScaAction.tsx")
require("getScaScope()" in helper, "sensitive action hook must query server-authoritative scope")
require("scope.data.required !== true" in helper, "non-EEA sensitive actions must bypass Bridge SCA")
require("Strong-authentication scope could not be verified" in helper, "unknown sensitive-action scope must fail closed")

transfer = read("supabase/functions/bridge-transfer/index.ts")
require("sca.required" in transfer and 'outcome: "sca_used"' in transfer, "verified EEA transfer must attach Bridge attestation")
payload = read("supabase/functions/_shared/providers/bridge-transfer-payload.ts")
for field in ("attestations", "sca", "outcome", "channel", "subchannel"):
    require(field in payload, f"Bridge payload missing {field}")
require("attestations:" in payload and "sca:" in payload and "outcome: input.sca_attestation.outcome" in payload, "Bridge SCA outcome must use the nested initiation contract")

shared = read("supabase/functions/_shared/sca.ts")
require('scope.status === "not_required"' in shared, "non-EEA scope must bypass Bridge SCA")
require('scope.status === "unknown"' in shared, "unknown scope must fail closed")
require("bridgeEeaScaEnforcementEnabled" in shared, "approval rollout gate missing")
require(shared.index("bridgeEeaScaEnforcementEnabled") < shared.index("resolveBridgeScaScope(params.supabase, params.userId)"), "disabled rollout must bypass protected backends before provider scope")
require('"password"' in shared.split("includes(key)", 1)[0], "password must be excluded from dynamic-link evidence")

migration = read("supabase/migrations/20260821170000_universal_sca_authorizations.sql")
require("array['pin', 'totp']" in migration, "database authorization must enforce transaction PIN plus TOTP")
require(not (ROOT / "supabase/migrations/20260827180000_bridge_eea_sca_password_factor.sql").exists(), "unapproved password-factor migration must not exist")

config = read("supabase/config.toml")
for endpoint in ("sca-scope", "sca-authorize", "sca-wallet-access"):
    require(f"[functions.{endpoint}]" in config, f"missing config for {endpoint}")

print("web_sca_regression_audit: PASS")

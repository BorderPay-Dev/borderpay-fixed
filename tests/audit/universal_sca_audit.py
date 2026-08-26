#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def text(path: str) -> str:
    return (ROOT / path).read_text()

def require(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)

migration = text('supabase/migrations/20260821170000_universal_sca_authorizations.sql')
activation = text('supabase/migrations/20260821173000_universal_sca_balance_rls_activation.sql')
require("verified_factors @> array['pin', 'totp']" in migration, 'authorization must require PIN and TOTP')
require('consumed_at is null' in migration and 'expires_at > now()' in migration, 'authorization must be single-use and unexpired')
require('has_fresh_sca_wallet_access(auth.uid())' in activation, 'wallet owner RLS must require fresh SCA')
require('consume_totp_counter' in migration and 'last_totp_counter < p_counter' in migration, 'TOTP codes must be single-use')

authorize = text('supabase/functions/sca-authorize/index.ts')
require('verifyFactor("verify-pin"' in authorize and 'verifyFactor("verify-2fa"' in authorize, 'issuer must verify both server-side factors')
require('const totpResult = pinResult.ok' in authorize, 'TOTP must only be consumed after the PIN succeeds')

shared = text('supabase/functions/_shared/sca.ts')
require('UNIVERSAL_SCA_ENFORCEMENT_ENABLED' in shared, 'backend enforcement must have a server-controlled mobile rollout gate')
require('resolveScaResidencyRequirement(params.supabase, params.userId)' in shared, 'backend consumption must resolve authoritative residency')
require('if (!residency.required) return { ok: true }' in shared, 'known non-EEA accounts must bypass the extra SCA layer')
require('verification_not_approved' in shared, 'unverified users must remain outside the EEA SCA flow')
require('return { required: false, country: null, reason: "residency_unknown" }' in shared, 'unknown residency must not impose EEA SCA globally')
require('"IS"' in shared and '"LI"' in shared and '"NO"' in shared, 'EEA scope must include Iceland, Liechtenstein, and Norway')
require('"GB"' not in shared.split('const EEA_COUNTRY_CODES', 1)[1].split(']);', 1)[0], 'UK must not be classified as EEA')
require('"CH"' not in shared.split('const EEA_COUNTRY_CODES', 1)[1].split(']);', 1)[0], 'Switzerland must not be classified as EEA')

authorize = text('supabase/functions/sca-authorize/index.ts')
require('body.action === "requirement"' in authorize, 'client SCA requirement must come from an authenticated server lookup')
require('resolveScaResidencyRequirement(supabase, user.id)' in authorize, 'issuer must use authoritative residency')

hook = text('utils/security/useScaRequirement.ts')
require("result?.data?.sca_required === true ? 'required' : 'not_required'" in hook, 'client must require SCA only after positive verified-EEA classification')

dialog = text('components/security/SCAChallengeDialog.tsx')
require('useScaRequirement(props.open)' in dialog and "requirement !== 'not_required'" in dialog, 'shared SCA dialog must bypass only an authoritative non-EEA result')

totp = text('supabase/functions/verify-2fa/index.ts')
require("'consume_totp_counter'" in totp and "code: 'totp_replayed'" in totp, 'TOTP verifier must reject replayed counters')

protected = {
    'supabase/functions/bridge-transfer/index.ts': 'bridgeProvider.createTransfer',
    'supabase/functions/bridge-external-account/index.ts': 'bridgeFetch({',
    'supabase/functions/external-wallet/index.ts': 'createCryptoRoute({',
}
for path, mutation in protected.items():
    source = text(path)
    require('consumeScaAuthorization({' in source, f'{path} must consume SCA')
    require(source.index('consumeScaAuthorization({') < source.rindex(mutation), f'{path} must consume SCA before provider mutation')

yellowcard = text('supabase/functions/yellowcard-transaction/index.ts')
require('code: "yellow_card_payout_funding_not_configured"' in yellowcard,
        'Yellow Card production payout must remain unavailable until its SCA and treasury funding contract is complete')

send = text('components/send/SendMoneyFlow.tsx')
require("operation: 'payment'" in send and 'sca_authorization_id' in send, 'Send must obtain and submit bound SCA')
require("processTransaction('__biometric__')" not in send, 'local biometric must not authorize money movement')
require("const scaRequired = scaRequirement !== 'not_required'" in send, 'Send must require the second factor while verified-EEA classification is pending or confirmed')
require('PINManager.verifyTransactionPIN(userId, pin)' in send, 'non-EEA Send must retain transaction PIN verification')

for path in (
    'components/settings/ChangePIN.tsx',
    'components/settings/ChangePassword.tsx',
    'components/settings/SettingsScreen.tsx',
    'components/security/TwoFactorSetup.tsx',
):
    require('useScaRequirement()' in text(path), f'{path} must scope extra SCA to EEA residency')

for path in ('supabase/functions/webauthn-register-verify/index.ts', 'supabase/functions/webauthn-delete/index.ts'):
    require('consumeScaAuthorization({' in text(path), f'{path} must protect login credential changes with SCA')
require('tryBiometricEnrollment' not in text('components/auth/LoginScreen.tsx'), 'password login must not silently enroll a new biometric credential')

print('EEA-scoped SCA audit: PASS')

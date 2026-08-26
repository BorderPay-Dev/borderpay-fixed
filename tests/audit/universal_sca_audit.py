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
provider_scope = text('supabase/migrations/20260826120000_provider_scoped_sca_financial_reads.sql')
admin_bypass = text('supabase/migrations/20260826123000_provider_scoped_sca_admin_bypass.sql')
require("verified_factors @> array['pin', 'totp']" in migration, 'authorization must require PIN and TOTP')
require('consumed_at is null' in migration and 'expires_at > now()' in migration, 'authorization must be single-use and unexpired')
require('has_fresh_sca_wallet_access(auth.uid())' in activation, 'wallet owner RLS must require fresh SCA')
require('sca_customer_scopes' in provider_scope and "source = 'bridge_customer_api'" in provider_scope, 'financial read scope must come from Bridge')
require('if not found then return true' in provider_scope, 'compatible rollout must not lock published non-EEA mobile clients before preflight')
require('can_read_bridge_financial_data(auth.uid())' in provider_scope, 'financial owner policies must enforce provider-scoped SCA')
require('transactions_sca_read_guard' in provider_scope and 'as restrictive for select' in provider_scope, 'transaction history must have a restrictive SCA read guard')
require('if public.is_borderpay_admin() then' in admin_bypass, 'active operators must bypass customer SCA read policies')
require('consume_totp_counter' in migration and 'last_totp_counter < p_counter' in migration, 'TOTP codes must be single-use')

authorize = text('supabase/functions/sca-authorize/index.ts')
require('verifyFactor("verify-pin"' in authorize and 'verifyFactor("verify-2fa"' in authorize, 'issuer must verify both server-side factors')
require('const totpResult = pinResult.ok' in authorize, 'TOTP must only be consumed after the PIN succeeds')
require(r'/^\d{6}$/.test(pin)' in authorize, 'Bridge SCA knowledge factor must require a 6-digit PIN')

shared = text('supabase/functions/_shared/sca.ts')
require('UNIVERSAL_SCA_ENFORCEMENT_ENABLED' in shared, 'backend enforcement must have a server-controlled mobile rollout gate')
require('resolveScaResidencyRequirement(params.supabase, params.userId)' in shared, 'backend consumption must resolve residency when no provider override exists')
require('if (!residency.required) return { ok: true, required: false, applied: false }' in shared, 'known non-EEA accounts must bypass the extra SCA layer')
require('attestations: { sca: "sca_used" as const }' in shared, 'Bridge SCA attestation must use the required enum string')
require('verification_not_approved' in shared, 'unverified users must remain outside the EEA SCA flow')
require('return { required: false, country: null, reason: "residency_unknown" }' in shared, 'unknown residency must not impose EEA SCA globally')
require('"IS"' in shared and '"LI"' in shared and '"NO"' in shared, 'EEA scope must include Iceland, Liechtenstein, and Norway')
require('"GB"' not in shared.split('const EEA_COUNTRY_CODES', 1)[1].split(']);', 1)[0], 'UK must not be classified as EEA')
require('"CH"' not in shared.split('const EEA_COUNTRY_CODES', 1)[1].split(']);', 1)[0], 'Switzerland must not be classified as EEA')

authorize = text('supabase/functions/sca-authorize/index.ts')
require('body.action === "requirement"' in authorize, 'client SCA requirement must come from an authenticated server lookup')
require('loadAndAssertBridgeIdentityInvariant(supabase, userId)' in authorize, 'issuer must bind the authenticated user to one Bridge customer')
require('bridgeProvider.getCustomerProfile(customerId)' in authorize, 'Bridge Customer API must be authoritative for EEA residency')
require('sca_scope_unavailable' in authorize, 'unknown provider scope must fail closed')
require('.from("sca_customer_scopes").upsert' in authorize, 'provider scope must be persisted for database enforcement')

hook = text('utils/security/useScaRequirement.ts')
require("setState('unavailable')" in hook, 'provider scope failures must not be treated as non-EEA')

for path in ('components/app/Dashboard.tsx', 'components/business/BusinessDashboard.tsx'):
    dashboard = text(path)
    require('const financialReadAllowed =' in dashboard, f'{path} must compute an authoritative financial read gate')
    require('if (!financialReadAllowed) return;' in dashboard, f'{path} must not fetch before scope/grant resolution')
    require('backendAPI.financial.invalidateForUser(userId)' in dashboard, f'{path} must purge cached financial snapshots while locked')
    require('Financial information locked' in dashboard, f'{path} must render a non-sensitive locked state')

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

provider = text('supabase/functions/_shared/providers/bridge.ts')
require('getWalletTransferPolicy' in provider and 'initiation_required: data?.initiation_required === true' in provider, 'Bridge wallet response must control transfer SCA applicability')
require('...(input.initiation ? { initiation: input.initiation } : {})' in provider, 'Bridge provider must serialize the attestation')
bridge_transfer = text('supabase/functions/bridge-transfer/index.ts')
require(bridge_transfer.index('getWalletTransferPolicy') < bridge_transfer.index('bridgeProvider.createTransfer'), 'wallet SCA policy lookup must precede transfer creation')
require('required: bridgeInitiationRequired' in bridge_transfer, 'provider wallet policy must override local residency for transfer enforcement')
require('initiation: bridgeInitiation' in bridge_transfer, 'completed SCA attestation must be sent to Bridge')

print('EEA-scoped SCA audit: PASS')

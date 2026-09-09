#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
TX=(ROOT/'supabase/functions/yellowcard-receive/index.ts').read_text()
PAYLOAD=(ROOT/'supabase/functions/_shared/providers/yellowcard-payload.ts').read_text()
WEBHOOK=(ROOT/'supabase/functions/yellowcard-webhook/index.ts').read_text()
VERIFY=(ROOT/'supabase/functions/_shared/providers/yellowcard-webhook.ts').read_text()
SQL='\n'.join((ROOT/path).read_text() for path in (
 'supabase/migrations/20260819135000_yellowcard_signed_webhook_events.sql',
 'supabase/migrations/20260819140000_yellowcard_webhook_atomic_projection.sql',
))
CONFIG=(ROOT/'supabase/config.toml').read_text()

checks={
 'receive country always matches authenticated profile': 'direction === "receive" && profileCountry !== country' in TX and 'allow_all_receive_countries' not in TX,
 'browser identity substitution absent': 'allow_sandbox_identity_sample' not in TX and 'Sample Name' not in TX,
 'payload independently enforces recipient country': 'yellow_card_recipient_country_must_match_receive_country' in PAYLOAD,
 'runtime uses provider channelType for receive': TX.count('channelType: yellowCardPayloadAccountType(context.channel)') == 1,
 'runtime does not send selected channel ID': 'channelId: str(context.selectedChannel?.id)' not in TX,
 'runtime excludes simulator-only forceAccept': 'forceAccept' not in TX and 'forceAccept' not in PAYLOAD,
 'production receive always requires full recipient KYC': 'const kycTier = "full" as const' in TX and 'yellowCardReducedKycEligible' not in TX,
 'shared receive payload cannot request reduced KYC': 'kycTier?: "full" | "reduced"' not in PAYLOAD and 'retailKyc(input.recipient as YellowCardRetailKyc, "recipient")' in PAYLOAD,
 'business receive uses Yellow Card institution identity': all(token in TX for token in [
   'customerType = lower(profile.account_type) === "business"',
   '.from("business_profiles")',
   'businessName: str(business?.company_name)',
   'businessId: str(business?.registration_number)',
   'customerType: context.customerType',
 ]),
 'full recipient KYC includes Yellow Card required fields': all(field in PAYLOAD for field in [
   'phone: required(input.phone, `${prefix}_phone`)',
   'address: required(input.address, `${prefix}_address`)',
   'dob: required(input.dob, `${prefix}_dob`)',
   'idNumber: required(input.idNumber, `${prefix}_id_number`)',
   'idType: required(input.idType, `${prefix}_id_type`)',
 ]),
 'webhook verifies exact raw body HMAC': 'X-YC-Signature' in WEBHOOK and 'crypto.subtle.verify' in VERIFY,
 'webhook api key must match configured key': 'event.apiKey !== credentials.apiKey' in WEBHOOK,
 'current v2 settlement events are accepted as evidence only': all(x in VERIFY for x in ('CONVERT', 'CRYPTO_SEND', 'CRYPTO_RECEIVE', 'projectTransaction: Boolean(direction)')),
 'webhook contract rejects status mismatch and missing provider id': 'explicitStatus !== eventStatus' in VERIFY and '!providerTransactionId' in VERIFY,
 'webhook ownership checks sequence direction and provider id atomically': all(x in SQL for x in ('for update', 'direction_mismatch', 'provider_transaction_mismatch')),
 'stale events cannot regress state': 'stale_event_ignored' in SQL and 'v_previous_executed_at >= p_executed_at' in SQL,
 'webhook evidence is immutable and idempotent': all(x in SQL for x in ('event_fingerprint text not null unique', 'yellowcard_webhook_events is immutable', 'before truncate')),
 'unknown transaction requests documented retry': 'transaction_not_found_retry' in WEBHOOK and '503' in WEBHOOK,
 'signed apply path is service-role only': "auth.role(), '') <> 'service_role'" in SQL and 'to service_role' in SQL,
 'provider callback bypasses JWT only for HMAC verification': '[functions.yellowcard-webhook]' in CONFIG and 'verify_jwt = false' in CONFIG,
}
for name,ok in checks.items(): print(('PASS' if ok else 'FAIL')+': '+name)
if not all(checks.values()): raise SystemExit(1)
print('Yellow Card receive identity and webhook audit: PASS')

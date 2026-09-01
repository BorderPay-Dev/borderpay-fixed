# Bridge EEA SCA initial QA evidence index

Prepared: 1 September 2026

This package contains controlled QA evidence only. It does not claim a live or
production Bridge test.

## Review document

- `docs/BRIDGE_EEA_SCA_EVIDENCE_PACKAGE_2026-08-31.md`
- `docs/BRIDGE_EEA_SCA_RECOVERY_POLICY.md`
- `docs/BRIDGE_EEA_SCA_MONITORING_AND_INCIDENT_RUNBOOK.md`

## Controlled screenshots

- `screenshots/01-account-access-pin.png`
- `screenshots/02-account-access-totp.png`
- `screenshots/03-payment-context.png`
- `screenshots/04-factor-enrollment.png`
- `screenshots/05-non-eea-bypass.png`
- `screenshots/06-fund-in-excluded.png`

## Test and logging evidence

- `dynamic-linking-test-results.txt`
- `sanitized-sca-log-samples.json`

## Source controls

- EEA scope and dynamic linking: `supabase/functions/_shared/sca.ts`
- factor verification/authorization: `supabase/functions/sca-authorize/index.ts`
- Bridge transfer attestation: `supabase/functions/bridge-transfer/index.ts`
- recovery restriction: `supabase/migrations/20260901110000_bridge_sca_recovery_restriction.sql`
- controlled activation: `supabase/migrations/20260901120000_bridge_eea_sca_controlled_activation.sql`
- monitoring: `supabase/functions/sca-monitoring/index.ts`
- five-year retention: `supabase/functions/certification-audit-delivery/index.ts`

## Deferred until Bridge authorizes QA

- production transaction test;
- production screen recording;
- signed production WORM receipt and delivery-health snapshot; and
- production QA account credentials shared through an approved secure channel.

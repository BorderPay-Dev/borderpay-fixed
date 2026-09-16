# Unified Pre-Deployment Gate Report

- Generated (UTC): 2026-09-16T00:39:02Z
- Overall: **PASS**

## Stage 1 - Repository Integrity

- Result: **PASS**
- Started: `2026-09-16T00:37:53Z`
- Ended: `2026-09-16T00:37:59Z`

### Evidence

- `PASS` Clean repository state (or explicit CI mode): dirty allowed by mode
- `PASS` Required gate/audit files exist: all required files present
- `PASS` No Maplerad runtime references: SKIP (ci mode): runtime provider quarantine enforced in protected release gate
- `PASS` No unsupported provider runtime dependency: SKIP (ci mode): runtime provider quarantine enforced in protected release gate
- `PASS` Incident SQL remains quarantined: [safety-boundary] OK

### Blocking Issues

- None.

## Stage 2 - Runtime Contract

- Result: **PASS**
- Started: `2026-09-16T00:37:59Z`
- Ended: `2026-09-16T00:38:03Z`

### Evidence

- `PASS` compute_rc1_status.py --check: [rc1-status] PASS: committed status matches computed status=OPEN
- `PASS` verify_runtime_contract.py: SKIP (ci mode): no linked Supabase project, no SUPABASE_ACCESS_TOKEN
- `PASS` verify_financial_schema_contract.py: SKIP (ci mode): no linked Supabase project in runner
- `PASS` verify_financial_value_propagation.py: SKIP (ci mode): no linked Supabase project in runner
- `PASS` verify_business_platform_rc1.py: verify_business_platform_rc1: PASS

### Blocking Issues

- None.

## Mandatory Recent Release Regression Gates

- Result: **PASS**
- Started: `2026-09-16T00:38:03Z`
- Ended: `2026-09-16T00:39:02Z`

### Evidence

- `PASS` Blocking regression audit tests/audit/public_auth_defense_audit.py: public auth defense audit passed (33/33).
- `PASS` Blocking regression audit tests/audit/signup_compliance_release_audit.py: signup_compliance_release_audit: PASS
- `PASS` Blocking regression audit tests/audit/signup_abuse_protection_audit.py: PASS (4/4)
- `PASS` Blocking regression audit tests/audit/signup_abuse_race_hardening_audit.py: PASS (2/2)
- `PASS` Blocking regression audit tests/audit/signup_country_audit.py:      controlled∩active retained: ['AE', 'BD', 'BF', 'CM', 'ID', 'JM', 'KE', 'KW', 'MZ', 'NG', 'PH', 'SN', 'SZ', 'TH', 'TR', 'TT', 'TZ', 'UG', 'ZA']
- `PASS` Blocking regression audit tests/audit/signup_country_enforcement_audit.py: signup_country_enforcement_audit: PASS
- `PASS` Blocking regression audit tests/audit/signup_phone_optional_app_review_audit.py: signup_phone_optional_app_review_audit: PASS (7/7)
- `PASS` Blocking regression audit tests/audit/signup_provider_precreate_audit.py: PASS (4/4)
- `PASS` Blocking regression audit tests/audit/operator_bridge_frontend_audit.py: PASS: 29/29 operator frontend invariants
- `PASS` Blocking regression audit tests/audit/operator_bridge_readonly_app_audit.py: PASS: 45/45 operator read-only invariants
- `PASS` Blocking regression audit tests/audit/operator_treasury_pwa_audit.py: PASS: 12/12 operator treasury PWA invariants
- `PASS` Blocking regression audit tests/audit/support_auto_triage_audit.py: Support auto-triage audit passed (54/54)
- `PASS` Blocking regression audit tests/audit/september_business_maintenance_automation_audit.py: business maintenance automation audit passed (36/36)
- `PASS` Blocking regression audit tests/audit/business_onboarding_lifecycle_audit.py: business onboarding lifecycle audit passed (18/18)
- `PASS` Blocking regression audit tests/audit/partner_commercial_billing_audit.py: Partner commercial billing audit passed (12/12).
- `PASS` Blocking regression audit tests/audit/partner_direct_invite_admin_audit.py: Partner direct invite audit passed (12/12).
- `PASS` Blocking regression audit tests/audit/partner_invoice_flutterwave_reconciliation_audit.py: Partner invoice Flutterwave audit passed (16/16).
- `PASS` Blocking regression audit tests/audit/partner_white_label_e2e_audit.py: Partner white-label end-to-end audit passed (11/11).
- `PASS` Blocking regression audit tests/audit/partner_white_label_email_audit.py: Partner white-label email audit passed (11/11).
- `PASS` Blocking regression audit tests/audit/partner_workspace_e2e_audit.py: Partner workspace audit passed (27/27).
- `PASS` Blocking regression audit tests/audit/bridge_wallet_activity_projection_audit.py: bridge_wallet_activity_projection_audit: PASS
- `PASS` Blocking regression audit tests/audit/bridge_wallet_activity_schema_compat_audit.py: PASS (6/6 invariants)
- `PASS` Blocking regression audit tests/audit/dashboard_instant_financial_cache_audit.py: dashboard_instant_financial_cache_audit: PASS
- `PASS` Blocking regression audit tests/audit/dashboard_spendable_wallet_chips_audit.py:   account chip mark:    large w-12 h-12 treatment
- `PASS` Blocking regression audit tests/audit/native_receipt_export_audit.py: PASS: receipt PDF exports through native iOS/Android and browser paths
- `PASS` Blocking regression audit tests/audit/verification_maintenance_email_audit.py:   ✓ month-end billing date
- `PASS` Blocking regression audit tests/audit/wallet_active_rows_audit.py:   shared cache:    raw wallet/VA rows preserved for add-wallet
- `PASS` Blocking regression audit tests/audit/wallet_detail_navigation_audit.py: wallet detail navigation audit passed
- `PASS` Blocking regression audit tests/audit/bridge_transfer_runtime_regression_audit.py: bridge_transfer_runtime_regression_audit: PASS
- `PASS` Blocking regression audit tests/audit/crypto_to_crypto_route_fee_audit.py:   ✓ saved destinations use /v0/transfers directly; liquidation routes remain historical only
- `PASS` Blocking regression audit tests/audit/verification_tos_external_handoff_audit.py: verification_tos_external_handoff_audit: PASS (14/14)
- `PASS` Blocking regression audit tests/audit/kyb_backend_launcher_audit.py: kyb_backend_launcher_audit: PASS (17/17)
- `PASS` Blocking regression audit tests/audit/p0_native_kyb_receipt_regression_audit.py: p0_native_kyb_receipt_regression_audit: PASS (25/25)
- `PASS` Blocking regression audit tests/audit/eurc_eu_flag_regression_audit.py: EURC EU flag regression audit passed (7/7)
- `PASS` Blocking regression audit tests/audit/bridge_kyb_cross_platform_callback_audit.py: PASS: 20/20 cross-platform KYB callback gates (5 each) and core tests
- `PASS` Blocking regression audit tests/audit/future_wallet_base_assets_audit.py: future_wallet_base_assets_audit: PASS (5/5)
- `PASS` Blocking regression audit tests/audit/customer_wallet_asset_boundary_audit.py: customer_wallet_asset_boundary_audit: PASS (21/21)
- `PASS` Blocking regression audit tests/audit/bridge_kyb_existing_customer_resume_audit.py: bridge_kyb_existing_customer_resume_audit: PASS (18/18)
- `PASS` Blocking regression audit tests/audit/eea_payout_sca_challenge_audit.py: eea_payout_sca_challenge_audit: 18/18
- `PASS` Blocking regression audit tests/audit/bridge_sca_entrypoints_audit.py: Bridge SCA entrypoint coverage: PASS (4 entrypoints)
- `PASS` Blocking regression audit tests/audit/eurc_external_withdrawal_audit.py: EURC external withdrawal audit passed (10/10)

### Blocking Issues

- None.

## Stage 3 - Financial Correctness Audits

- Result: **PASS**
- Started: `2026-09-16T00:39:02Z`
- Ended: `2026-09-16T00:39:02Z`

### Evidence

- `PASS` Financial correctness audit suite: SKIP (ci mode): full audit suite runs in protected pre-release environment

### Blocking Issues

- None.

## Stage 4 - Bridge Integration Verification

- Result: **PASS**
- Started: `2026-09-16T00:39:02Z`
- Ended: `2026-09-16T00:39:02Z`

### Evidence

- `PASS` Bridge integration deep contract checks: SKIP (ci mode): deep runtime contract checks run in protected pre-release environment

### Blocking Issues

- None.

## Stage 5 - Architecture Policy

- Result: **PASS**
- Started: `2026-09-16T00:39:02Z`
- Ended: `2026-09-16T00:39:02Z`

### Evidence

- `PASS` Architecture policy deep checks: SKIP (ci mode): architecture policy checks run in protected pre-release environment

### Blocking Issues

- None.

## Stage 6 - Deployment Readiness

- Result: **PASS**
- Started: `2026-09-16T00:39:02Z`
- Ended: `2026-09-16T00:39:02Z`

### Evidence

- `PASS` Deployment readiness deep checks: SKIP (ci mode): deployment readiness checks run in protected pre-release environment

### Blocking Issues

- None.

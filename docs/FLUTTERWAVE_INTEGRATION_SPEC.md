# Flutterwave Integration Spec (Bridge-Aligned)

Date: 2026-06-28  
Owner: BorderPay Engineering

## 1) Purpose

Add African local rails (collections + payouts) through Flutterwave **without** creating a second financial engine.

BorderPay product intent remains:

- `Receive` = rail -> wallet credit
- `FX` = wallet -> wallet conversion
- `Send/Payout` = wallet -> external destination

Bridge remains treasury/orchestration source of truth for global rails and compliance lifecycle. Flutterwave is a rail adapter.

## 2) Source of Truth Hierarchy

1. Bridge onboarding/compliance eligibility (KYC/KYB, country support)
2. BorderPay wallet/ledger/snapshot contract
3. Flutterwave rail capability per corridor
4. UI `supported_routes` returned by backend

UI never guesses availability.

## 3) Scope

### In scope (Phase 1)

- Local collections:
  - NGN bank transfer
  - KES mobile money (M-Pesa)
  - GHS mobile money
- Local payouts:
  - NGN bank account
  - KES mobile money
  - GHS mobile money
- Unified route selection from existing `Receive` / `Send` screens
- Webhook ingestion + idempotent ledger writes

### Out of scope (Phase 1)

- New onboarding provider
- New KYC/KYB engine
- Flutterwave-driven FX pairs

## 4) Architecture

### 4.1 Receive flow

`Flutterwave rail event -> webhook -> normalize event -> ledger credit -> wallet projection -> UI`

### 4.2 Send/Payout flow

`User send request -> route resolver -> payout request to Flutterwave -> pending state -> webhook status -> ledger finalization -> UI`

### 4.3 FX boundary

Flutterwave is **not** used as FX engine.  
FX continues through Bridge-backed policy (`supported_pairs`), wallet-to-wallet only.

## 5) Data Model Additions

- `rail_transactions`
  - `id`
  - `provider` (`bridge` | `flutterwave`)
  - `provider_reference`
  - `user_id`
  - `account_type`
  - `direction` (`receive` | `payout`)
  - `currency`
  - `amount_minor`
  - `status`
  - `metadata_json`
  - unique(`provider`, `provider_reference`)

- `external_destinations`
  - extend type enum:
    - `bank_account`
    - `mobile_money`
    - `crypto_address`
  - include `provider_capability` and validation state

- `webhook_events`
  - add provider tag + raw payload checksum for replay safety

## 6) Backend Functions (planned)

- `flutterwave-initiate-collection`
- `flutterwave-initiate-payout`
- `flutterwave-validate-destination`
- `flutterwave-webhook`
- `flutterwave-sync-status` (repair job)

All behind feature flags:

- `FLW_RECEIVE_ENABLED`
- `FLW_PAYOUT_ENABLED`
- `FLW_WEBHOOK_ENABLED`

## 7) Webhook Contract

Required guarantees:

- Verify signature before processing
- Idempotency by `provider_reference + event_type`
- Append-only event log
- Deterministic status transitions:
  - `submitted -> processing -> completed|failed|reversed`

No direct UI status writes from webhook handler without ledger+projection update.

## 8) Route Resolver Contract

Backend returns route options only if executable:

```json
{
  "receive_routes": ["bridge_va_usd", "bridge_va_eur", "flw_ngn_bank", "flw_kes_momo"],
  "payout_routes": ["bridge_external_bank", "bridge_crypto", "flw_ngn_bank", "flw_kes_momo"]
}
```

Frontend renders only returned routes.

## 9) Fees and Economics

No hidden markup in initial rollout.

- Persist provider fee at execution time:
  - `provider_fee_minor`
  - `fx_spread_minor` (if applicable)
  - `platform_fee_minor`
- Transaction history must show customer-facing fee totals.

## 10) Security and Risk Controls

- Provider secrets in Supabase secrets only
- Webhook signature verification mandatory
- Replay protection window
- Amount and corridor limits per account tier
- Velocity checks for payouts
- Alerting on failed webhook spikes and stale payout states

## 11) Rollout Plan

### Stage 0
- Backend scaffolding + feature flags + no UI exposure

### Stage 1
- Internal test users for NGN/KES receive

### Stage 2
- Internal test users for NGN/KES payouts

### Stage 3
- Controlled beta cohort

### Stage 4
- General availability by corridor

Rollback: disable `FLW_*` flags and keep Bridge flows active.

## 12) Acceptance Criteria

For each enabled corridor:

- Receive completed event credits wallet correctly
- Payout terminal event reconciles ledger/projection/transaction history
- Notifications emitted
- No raw provider error shown to users
- Runtime trace available by correlation id

## 13) Open Decisions

- First launch corridors: `NGN + KES` only vs `NGN + KES + GHS`
- Destination validation UX for mobile money handles
- Manual review threshold values

## 14) Implementation Order

1. Webhook verifier + event store
2. Receive rails (credit path)
3. Payout rails (debit/finalization path)
4. Route resolver wiring
5. Admin observability panel for Flutterwave events


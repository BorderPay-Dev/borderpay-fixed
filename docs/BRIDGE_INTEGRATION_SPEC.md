# Bridge Integration Specification (BorderPay)

Status: Living contract  
Owner: BorderPay Engineering  
Scope: Bridge-powered payment, identity, wallet, virtual-account, transfer, webhook, and reconciliation behavior.

## 1. Product Truth

- Bridge is BorderPay's only payment infrastructure provider.
- BorderPay is not a mirror of Bridge; BorderPay keeps internal normalized projections for product UX and logic.
- Internal product/UI must depend on BorderPay state, not raw provider payload structure.

## 2. Source-of-Truth Boundaries

### Bridge external source of truth
- KYC/KYB decision outcomes
- Virtual account lifecycle events
- Wallet lifecycle events
- Transfer/payment events

### BorderPay internal source of truth
- User-facing eligibility and gating outcomes
- Internal queue lifecycle state
- Internal projection tables:
  - `bridge_wallets`
  - `bridge_virtual_accounts`
  - `bridge_transfers`
- Reconciliation status and operational visibility

## 3. Webhook and Queue Model

### Webhook layer contract
- Purpose: translation/verification/ingestion only.
- Must:
  - verify signature + replay window
  - parse event envelope
  - atomically persist ingress + queue enqueue
- Must not contain business-flow side effects.

### Ingress lifecycle domain
- `received`
- `queued`
- `rejected`
- `duplicate`

### Internal queue lifecycle domain
- `queued`
- `processing`
- `completed` (terminal success)
- `failed` (terminal failure)

### Canonical mutation surfaces
- Ingress transitions:
  - webhook receiver
  - `ingest_bridge_event`
- Queue transitions:
  - `claim_pending_events`
  - `complete_pending_event`
  - `fail_pending_event`

## 4. Identity and Funding Rules

### Individual
- No KYC fee.
- Virtual account eligibility requires:
  - Bridge KYC approved
  - Stablecoin wallet exists
  - Stablecoin balance >= USD 20 equivalent
  - Currency/country corridor supported by Bridge

### Business
- No onboarding/KYB fee.
- Virtual account eligibility requires:
  - Bridge KYB approved
  - Stablecoin wallet exists
  - Stablecoin balance >= USD 100 equivalent
  - Currency/country corridor supported by Bridge

## 5. Stablecoin Wallet Lifecycle

Required behavior:
- Wallet creation occurs automatically after successful Bridge KYC/KYB.
- Wallet creation is idempotent (replays/retries do not create duplicates).
- Wallet projections in BorderPay remain internal normalized state.

Acceptance checks:
- KYC/KYB success event replayed N times => exactly one wallet projection per chain/symbol policy.
- Bridge API transient errors => retry-safe, no duplicate wallet rows.

## 6. Virtual Account Lifecycle

Required behavior:
- VA is requested on demand only (not pre-provisioned universally).
- VA creation is eligibility-gated by identity + funding + corridor support.
- VA creation is idempotent under retries/replays.

Acceptance checks:
- Ineligible request paths are rejected deterministically and logged.
- Eligible request + replay does not create duplicate active VAs for same provider VA identifier.

## 7. Transfer Lifecycle and Reconciliation

Required behavior:
- Transfer projections (`bridge_transfers`) represent provider state and reconciliation metadata.
- Reconciliation-required cases must be explicit and non-silent.
- Unknown attribution must not silently resolve to success.

Acceptance checks:
- Duplicate transfer webhooks do not duplicate transaction effects.
- Unmapped owner/customer paths set reconciliation-needed state.

## 8. Webhook Coverage Contract

Policy:
- Every supported Bridge event type must map to a defined handler path.
- Unknown event types must be safely logged and completed without unsafe side effects.
- Unknown source values must fail closed.

Tracking:
- Maintain a versioned list of handled event families and explicit unknown-event behavior.

## 9. Idempotency Guarantees

Must hold across replay/retry:
- No duplicate transfers
- No duplicate wallet creation
- No duplicate virtual account creation
- No duplicate internal notifications tied to webhook identity

Mechanisms (expected):
- Unique provider identifiers
- Upserts/unique constraints
- Idempotency keys
- Queue claim semantics and terminal status handling

## 10. Failure Recovery Requirements

On Bridge/API/network failure:
- Retries must be safe and bounded.
- Partial failures must not leave money state inconsistent.
- Operational status must remain observable and reconcilable.

## 11. Financial Correctness Gate (Pre-permission-hardening)

Before RBAC/RLS tightening rollout:
- Verify webhook ingestion end-to-end
- Verify wallet auto-provisioning + idempotency
- Verify VA gating rules (identity + funding + corridor)
- Verify transfer idempotency and reconciliation paths
- Verify queue retry/failure behavior under provider faults
- Verify frontend continues to use internal projections

Gate output:
- Pass/fail matrix by flow
- Repro steps
- Evidence queries and event IDs
- Open risk list with severity

## 12. Change Control

- Schema changes: `supabase/migrations/` only.
- Incident recovery scripts: `scripts/incident/` only.
- `scripts/sql/` must not include lifecycle mutation logic.
- Any change to this spec requires:
  - linked implementation diff
  - regression test updates
  - rollout and rollback note


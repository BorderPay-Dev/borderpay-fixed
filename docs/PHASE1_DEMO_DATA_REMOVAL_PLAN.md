# Phase 1 Demo Data Removal Plan (Incident Package Only)

Date: 2026-06-20  
Mode: Planning only (no execution performed)

## Affected IDs

- `6ab47d98-1855-4f6e-afb2-15dfa46c79d1` (`demo.business@borderpayafrica.com`, business demo)
- `a4b3fccf-ac76-41f1-9727-432feffd8dac` (`demo.individual@borderpayafrica.com`, individual demo)

## Step 1 — Isolation Verification (Evidence)

Requested tables:

| Table | Result |
|---|---|
| `bridge_customers` | Table does not exist in production schema |
| `bridge_wallets` | 0 |
| `bridge_virtual_accounts` | 0 |
| `bridge_transfers` | 0 |
| `pending_events` | 0 payload matches |
| `bridge_webhook_events` | 0 payload matches |
| `webhook_logs` | 0 event-join matches |
| `transactions` | 8 |
| `stablecoin_transactions` | 0 |
| `external_wallets` | 0 |
| `notifications` | 0 |
| `referrals` | 0 |
| `user_security` | 0 |
| `email_log` | 0 |

Additional logical/FK-linked tables discovered with non-zero rows:

| Table | Rows |
|---|---|
| `business_profiles` | 1 |
| `user_subscriptions` | 2 |
| `wallets` | 2 |
| `webauthn_challenges` | 2 |
| `webauthn_credentials` | 1 |
| `account_type_audit` | 1 |
| `auth.users` | 2 |
| `auth.identities` | 2 |
| `auth.sessions` | 1 |
| `auth.refresh_tokens` | 2 |

Per-profile non-zero dependencies:

- `6ab47d98-1855-4f6e-afb2-15dfa46c79d1`
  - `business_profiles=1`
  - `transactions=5` (all `provider=maplerad`)
  - `user_subscriptions.business_user_id=1`
  - `wallets=1`
  - `webauthn_challenges=2`
  - `webauthn_credentials=1`
  - `account_type_audit=1`
- `a4b3fccf-ac76-41f1-9727-432feffd8dac`
  - `transactions=3` (all `provider=maplerad`)
  - `user_subscriptions.user_id=1`
  - `wallets=1`

## Dependency Graph

```text
auth.users (2)
  ├─ auth.identities (2)
  ├─ auth.sessions (1)
  ├─ auth.refresh_tokens (2)
  ├─ user_profiles (2)  [logical owner node]
  │   ├─ transactions (8) [legacy maplerad rows]
  │   ├─ wallets (2)
  │   ├─ webauthn_challenges (2)
  │   ├─ webauthn_credentials (1)
  │   ├─ user_subscriptions.user_id (1 for individual demo)
  │   └─ account_type_audit (1, business demo)
  └─ business_profiles (1 for business demo)
      └─ user_subscriptions.business_user_id (1)

Bridge ingress/queue/event projection nodes
  bridge_wallets=0, bridge_virtual_accounts=0, bridge_transfers=0
  pending_events=0, bridge_webhook_events=0, webhook_logs=0, email_log=0
```

## Step 2 — Safe Delete Classification

- `6ab47d98-1855-4f6e-afb2-15dfa46c79d1`: **REQUIRES_CASCADE_REVIEW**
  - Reason: multiple non-zero dependent rows across auth/session/security and historical ledger-like tables.
- `a4b3fccf-ac76-41f1-9727-432feffd8dac`: **REQUIRES_CASCADE_REVIEW**
  - Reason: non-zero dependent rows (`transactions`, `user_subscriptions`, `wallets`, auth rows).

No profile is `SAFE_DELETE` as a standalone row delete.

## Deletion Order (Planned, Not Executed)

1. Verify target set exactly equals the two demo IDs and expected emails.
2. Verify expected dependency row counts match this plan (abort on mismatch).
3. Delete child/session/auth artifacts:
   - `auth.refresh_tokens`, `auth.sessions`, `auth.identities`
   - `webauthn_credentials`, `webauthn_challenges`, `wallets`
   - `user_subscriptions`, `transactions`, `account_type_audit`
4. Delete business projection row:
   - `business_profiles` (for business demo user only)
5. Delete primary profile rows:
   - `user_profiles` (2 rows)
6. Delete `auth.users` (2 rows) to complete isolation.
7. Post-delete verification queries must all pass before commit.

## Rollback Strategy (No-PITR Environment)

- Mandatory pre-execution:
  - Export every to-be-mutated row set (CSV/SQL) for each table in this plan.
  - Save exported artifacts in incident ticket storage with timestamp + operator.
- Runtime rollback:
  - Script is transaction-wrapped; any mismatch/error raises exception and rolls back automatically.
- Post-commit manual rollback:
  - Reinsert from pre-export snapshots in strict parent/child order.
  - Re-run verification queries and identity invariant gate.

## Post-Delete Verification Queries (Planned)

- Zero remaining target rows across all touched tables.
- Identity invariant gate:
  - `user_profiles`: `bridge_kyc_status='approved' and bridge_customer_id is null` => `0`
  - `business_profiles`: `bridge_kyb_status='approved' and bridge_customer_id is null` => `0`

## Success Criteria

1. Exactly two demo identities removed with no over-delete.
2. No residual dependencies for the two IDs in public/auth tables touched by this package.
3. No Bridge ingress/queue rows affected.
4. Financial Correctness Phase 1 gate evaluates:
   - `approved_without_customer_id == 0` (virtual expectation after this cleanup).

## Step 5 — Virtual Gate Re-Check (Assuming Only These Two Demo Profiles Removed)

Current baseline:

- `user_profiles.approved_without_customer = 2`
- `business_profiles.approved_without_customer = 1`

Both counts map exactly to the two confirmed demo profiles and one linked business row.  
Virtual result after planned cleanup:

- `user_profiles.approved_without_customer = 0`
- `business_profiles.approved_without_customer = 0`

Recommendation: **Phase 1 PASS** (virtual, contingent on successful incident execution and verification).


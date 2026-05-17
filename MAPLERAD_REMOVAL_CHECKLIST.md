# Maplerad removal — deployed function deletion checklist

The repo no longer carries any executable Maplerad path. The Supabase project
`orwrcpwsffjlvzuraxjc` still has a number of deployed edge functions that
were authored against the Maplerad client. The frontend no longer calls
them, but they remain reachable with the project's anon key — they must
be deleted (or redeployed as 410 stubs) before launch.

## Run order

```bash
PROJECT=orwrcpwsffjlvzuraxjc
```

Delete each slug with:

```bash
supabase functions delete <slug> --project-ref $PROJECT
```

Confirm afterwards with:

```bash
supabase functions list --project-ref $PROJECT | grep -i -E "maplerad|card|momo|...|<slug>"
```

## Slugs to DELETE (no frontend caller, no source-tree backing)

### Maplerad-only infrastructure

| Slug | Reason |
|---|---|
| `maplerad-webhook` | Inbound Maplerad webhooks no longer ingested. |
| `enroll-customer-full` | Maplerad customer enrollment via QuotaGuard. |
| `enroll-maplerad-customer` | Same. |
| `backfill-maplerad-customers` | Bulk Maplerad customer reconciliation. |
| `kyc-debug-maplerad` | Admin debug for Maplerad KYC. |
| `kyc-sync-pending` | Maplerad KYC sync job. |
| `query-kyc-status` | Maplerad-era admin lookup. (Verify no admin caller before deleting.) |

### Cards (frontend short-circuits via `cards_coming_soon`)

| Slug | Reason |
|---|---|
| `create-card` | No caller. |
| `get-cards` | No caller. |
| `get-card-transactions` | No caller. |
| `withdraw-card` | No caller. |
| `freeze-card` | No caller. |
| `unfreeze-card` | No caller. |
| `terminate-card` | No caller. |
| `get-card-charges` | No caller. |
| `mock-card-transaction` | QA-only mock. |
| `fund-card` | Vendored source rewritten to `501 cards_coming_soon`. **Redeploy from source rather than delete** so any stale caller fails loudly. |

### Virtual accounts / counterparties (frontend routed to Bridge)

| Slug | Reason |
|---|---|
| `create-virtual-account` | Replaced by `bridge-virtual-account`. |
| `create-usd-account` | Replaced by `bridge-virtual-account` `{currency:'USD'}`. |
| `create-dynamic-account` | Future-state (Yativo). |
| `check-account-status` | Read-only; deletable once admin tooling no longer reads Maplerad account state. Verify. |
| `get-account-rails` | Read-only; same caveat as above. |
| `create-counterparty` | Future-state until Bridge transfer smoke. |
| `get-counterparty` | Read-only; keep if any admin / history surface still reads it. Verify. |
| `get-account-counterparties` | Same. |

### Transfers / payouts

| Slug | Reason |
|---|---|
| `transfer` | Maplerad local payout. |
| `usd-transfer` | Maplerad USD ACH/wire. |
| `borderpay-transfer` | Vendored source rewritten to 410. **Redeploy from source** so deletion is loud, not silent. |
| `verify-transfer` | Read-only; keep until SendMoneyFlow stops calling it. Verify. |
| `get-transfers` | Read-only history; keep until UI cutover. Verify. |
| `get-all-transactions` | Read-only history; likely safe to keep — relies on `transactions` table. Verify. |

### Stablecoin / addresses

| Slug | Reason |
|---|---|
| `stablecoin-transfer` | Replaced by `bridge-transfer` (after sandbox smoke). |
| `generate-address` | Replaced by `bridge-wallet`. |
| `update-offramp` | Future-state. |
| `get-address` | Read-only; keep until UI no longer displays historical addresses. Verify. |

### Mobile money / African rails

| Slug | Reason |
|---|---|
| `get-momo-providers` | Vendored source rewritten to 410. Redeploy. |
| `mobile-money-collect` | No caller. |
| `verify-momo-otp` | No caller. |

### KYC writes

| Slug | Reason |
|---|---|
| `kyc-submit` | Vendored source rewritten to 410. Redeploy. |
| `verify-bvn` | Maplerad BVN check. No caller. |

### One-shot / bootstrap

| Slug | Reason |
|---|---|
| `provision-user-account` | Admin one-shot. |
| `bootstrap-mark-ngn` | Single-user bootstrap. |
| `Onboarding_welcome_function` | Superseded by `send-email` + verification flow. |
| `make-server-b83881a1` | Old Hono server. |
| `mock-collection-transaction` | QA-only mock. |

### Sync / FX

| Slug | Reason |
|---|---|
| `sync-users-to-maplerad` | Vendored source rewritten to 410. Redeploy. |
| `get-fx-rates` | Vendored source rewritten to 410. Redeploy. |
| `get-fx-history` | Read-only; verify no admin caller. |

## Slugs to KEEP

These are provider-neutral and still in use:

- `auth-signup`, `auth-signout`, `auth-reset-password`, `auth-reset-password-confirm`, `auth-verify-session`, `auth-resend-verification`, `verify-email-token`
- `get-user-profile`, `update-user-profile`, `get-customers`, `get-accounts`, `get-transactions`, `get-customer-transactions`, `get-wallets`, `get-business-wallets`, `get-wallets-history`, `get-wallet-history-by-currency`
- `get-currencies`, `get-institutions`, `fetch-bank-details`, `resolve-account`, `verify-transaction`, `fx`
- `bridge-customer`, `bridge-kyc-link`, `bridge-kyb-link`, `bridge-virtual-account`, `bridge-wallet`, `bridge-transfer`, `bridge-webhook`, `bridge-ping`
- `kyc-status` (rewritten to provider-neutral surface)
- `get-kyc-jobs`, `admin-signup`, `suspend-user` (admin)
- `send-email`, `send-welcome-blast`, `send-kyc-status-email`, `send-confirmation-email`, `smile-callback-handler`
- `poa-upload-url`, `poa-submit`, `upload-poa`
- `notifications-unread-count`, `get-notifications`, `mark-notification-read`, `mark-all-notifications-read`, `delete-notification`, `clear-notifications`
- `setup-pin`, `verify-pin`, `change-pin`, `setup-2fa`, `verify-2fa`, `disable-2fa`, `get-security-status`, `update-security-status`
- `upload-profile-picture`, `export-transactions`, `log-stablecoin-transaction`
- `credit-test-wallet` (test-only; consider deletion in a separate review)
- `process-pending-events` (Bridge router only; legacy `source='maplerad'` events drain terminal)
- `ping`

## Database

Per CTO direction:
- **No schema changes in this pass.** Maplerad-named columns
  (`user_profiles.maplerad_*`, `wallets.maplerad_wallet_id`,
  `fee_config.maplerad_fee_currency`, etc.) remain for audit / history.
- An archival migration to drop these columns is a separate proposal.

## Acceptance proof

After running the deletions, confirm with:

```bash
supabase functions list --project-ref $PROJECT | wc -l
supabase functions list --project-ref $PROJECT | grep -iE 'maplerad|momo|card|stablecoin-transfer|enroll-customer|backfill' || echo 'clean'
```

The grep should return `clean` for the Maplerad-specific slugs. Provider-
neutral slugs may still match `card` if any like `get-wallets-history` etc.
do — check the actual matches against the keep list above.

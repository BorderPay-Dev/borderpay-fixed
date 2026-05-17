# Bridge migration — deployment & smoke-test runbook

Project ref: `orwrcpwsffjlvzuraxjc`.
Source remediation has been accepted. This runbook covers the operational
sequence needed to take the Bridge integration to production. **No step
below should be skipped or reordered.** Money-movement flows
(`stablecoinAPI.sendTransfer`, `localPaymentsAPI.*`, `usPaymentsAPI.*`)
remain `rails_future_state` at the client layer until §6 sandbox smoke
passes end-to-end.

Out of scope for this runbook: any Yativo wiring, any decision to
re-enable client send flows, any schema-archival migration that drops
legacy Maplerad columns.

---

## 0 — Pre-flight checks

Run from a workstation with `supabase` CLI ≥ 1.190.x and access to the
project secrets.

```bash
PROJECT=orwrcpwsffjlvzuraxjc
supabase --version
supabase projects list | grep $PROJECT
supabase secrets list --project-ref $PROJECT \
  | grep -E 'BRIDGE_API_KEY|BRIDGE_API_KEY_SANDBOX|BRIDGE_BASE_URL|BRIDGE_WEBHOOK_PUBLIC_KEY|SUPABASE_SERVICE_ROLE_KEY|RESEND_API_KEY'
```

Required secrets:

| Secret | Value shape | Notes |
|---|---|---|
| `BRIDGE_API_KEY` | `sk-live-…` | Live key. Only used after §6 sandbox smoke is green AND CTO sign-off. |
| `BRIDGE_API_KEY_SANDBOX` | `sk-test-…` | Sandbox key, used for §6. |
| `BRIDGE_BASE_URL` | `https://api.bridge.xyz` | Single base for both environments; the key prefix selects sandbox vs live. |
| `BRIDGE_WEBHOOK_PUBLIC_KEY` | PEM SPKI string starting `-----BEGIN PUBLIC KEY-----` | Per-endpoint key issued by Bridge when the webhook endpoint is registered. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | standard | Auto-injected on edge functions. |

If `BRIDGE_API_KEY` is currently the same value as `BRIDGE_API_KEY_SANDBOX`
or any prior leaked key (incl. the live key pasted in chat earlier in this
project's history), **rotate before going further** and re-run §0.

The Supabase project must have its **spend cap disabled** (or sufficient
Edge Function quota) — otherwise §3 deploys will 402.

---

## 1 — Apply migrations (order matters)

Migrations carry RPCs that the new function code depends on. **Apply
migrations BEFORE deploying the matching function**, or the function
will 500 with `function does not exist` until the migration lands.

Run from repo root.

**First, confirm what your installed Supabase CLI actually supports.**
The CLI surface around migrations has changed across versions; do not
assume any specific flag exists.

```bash
PROJECT=orwrcpwsffjlvzuraxjc
supabase --version
supabase db push --help        # confirm the flags available in YOUR CLI
supabase migration list --project-ref $PROJECT   # show local vs remote diff
```

The expected `migration list` output should show the five new files
under "local" / pending side and `bridge_integration_phase0` already
applied remote.

Apply pending migrations the canonical way — from repo root, no per-file
flag:

```bash
supabase db push --project-ref $PROJECT
```

This pushes every pending file in `supabase/migrations/` in lexicographic
order. The five new files all share the `20260510_*` prefix and apply
together; ordering between them is independent (they touch disjoint
objects: phase1 tables, webhook ingest RPC, transactions partial unique
index + RPC, balance ledger, wallet credit RPC).

**If for any reason you need one migration at a time**, do NOT use an
unverified `--file` flag. Use the project's approved workflow:

- Run the SQL via the Supabase **SQL Editor** (Dashboard → SQL → New
  Query → paste contents → Run), then manually register it in
  `supabase_migrations.schema_migrations` so `supabase db push` sees it
  as applied. OR
- Use whichever migration tool your team standardised on
  (`dbmate`, custom script, etc.). Verify against
  `supabase migration list --project-ref $PROJECT` before and after.

Do not skip the `supabase migration list` verification step. If the
remote shows any of the five new versions as already applied, do **not**
re-apply — investigate first (someone else may have run them).

Migrations vs their dependents:

| Migration | Defines | Required by function |
|---|---|---|
| `20260510_bridge_phase1_first_class_tables.sql` | `bridge_virtual_accounts`, `bridge_wallets`, `bridge_transfers`, KYB columns on `business_profiles`, webhook entity backlink | `bridge-virtual-account`, `bridge-wallet`, `bridge-transfer`, `bridge-kyb-link`, `process-pending-events` (Bridge handlers) |
| `20260510_bridge_webhook_atomic_ingest.sql` | `ingest_bridge_event(...)`, `requeue_stuck_bridge_events(...)` | `bridge-webhook` |
| `20260510_bridge_transactions_mirror.sql` | `transactions_bridge_transfer_uniq` partial unique index + `upsert_bridge_transaction(...)` | `process-pending-events` (`handleBridgeTransfer`) |
| `20260510_bridge_balance_ledger.sql` | `bridge_virtual_account_balances`, `bridge_balance_ledger`, `apply_bridge_va_credit(...)` | `process-pending-events` (`handleBridgeVirtualAccount` activity branch) |
| `20260510_bridge_wallet_credit_rpc.sql` | `apply_bridge_wallet_credit_and_complete(...)` | `process-pending-events` (`handleBridgeVirtualAccount` individual mirror) |

Post-apply check (expect each function to exist with the correct return type):

```sql
select proname,
       pg_get_function_result(p.oid) as returns
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'ingest_bridge_event',
    'requeue_stuck_bridge_events',
    'upsert_bridge_transaction',
    'apply_bridge_va_credit',
    'apply_bridge_wallet_credit_and_complete'
  )
order by proname;
```

Verify the three new tables and the balance ledger are RLS-enabled:

```sql
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in (
    'bridge_virtual_accounts',
    'bridge_wallets',
    'bridge_transfers',
    'bridge_virtual_account_balances',
    'bridge_balance_ledger'
  );
```

All five should report `relrowsecurity = true`.

---

## 2 — Update the default provider setting

Once migrations are applied, switch the read-time default. New signups
fall through registry → `getDefaultProviderName()` → Bridge regardless,
but persisting the setting keeps ops dashboards and any future code
honest.

```sql
update public.provider_settings
   set value = '"bridge"'::jsonb,
       updated_at = now()
 where key = 'default_provider_for_new_signups';

select key, value from public.provider_settings
 where key in ('default_provider_for_new_signups', 'bridge.sandbox_mode', 'cards.enabled');
```

Expected:
- `default_provider_for_new_signups` → `"bridge"`
- `bridge.sandbox_mode` → `true` during §6; flip to `false` only after CTO sign-off post-§6.
- `cards.enabled` → `false` (unchanged).

---

## 3 — Deploy edge functions

Deploy in dependency order. Each command runs the local source from
`supabase/functions/<slug>/`.

```bash
PROJECT=orwrcpwsffjlvzuraxjc

# Shared module — re-deployed implicitly when functions that import it deploy
#   supabase/functions/_shared/providers/{registry.ts,types.ts,bridge.ts,bridge-client.ts}

# Bridge stack
supabase functions deploy bridge-ping            --project-ref $PROJECT
supabase functions deploy bridge-customer        --project-ref $PROJECT
supabase functions deploy bridge-kyc-link        --project-ref $PROJECT
supabase functions deploy bridge-kyb-link        --project-ref $PROJECT
supabase functions deploy bridge-virtual-account --project-ref $PROJECT
supabase functions deploy bridge-wallet          --project-ref $PROJECT
supabase functions deploy bridge-transfer        --project-ref $PROJECT
supabase functions deploy bridge-webhook         --project-ref $PROJECT

# Core (rewritten for Bridge)
supabase functions deploy auth-signup            --project-ref $PROJECT  # v89, provider-neutral
supabase functions deploy kyc-status             --project-ref $PROJECT  # Bridge-neutral surface
supabase functions deploy get-kyc-jobs           --project-ref $PROJECT  # Bridge-neutral admin surface
supabase functions deploy process-pending-events --project-ref $PROJECT  # Bridge router; legacy maplerad → terminal drain

# Quarantine stubs (so any stale caller gets 410 / 501 instead of an unmaintained handler)
supabase functions deploy fund-card              --project-ref $PROJECT  # 501 cards_coming_soon
supabase functions deploy kyc-submit             --project-ref $PROJECT  # 410 provider_removed
supabase functions deploy sync-users-to-maplerad --project-ref $PROJECT  # 410 provider_removed
supabase functions deploy borderpay-transfer     --project-ref $PROJECT  # 410 provider_removed
supabase functions deploy get-fx-rates           --project-ref $PROJECT  # 410 provider_removed
supabase functions deploy get-momo-providers     --project-ref $PROJECT  # 410 provider_removed
supabase functions deploy provisioning-request   --project-ref $PROJECT  # 410 provider_removed
```

Watch for these failures:

- `PaymentRequiredException: Max number of functions reached` → spend cap is still on. Disable or delete unused functions (see §5) and retry.
- `function ingest_bridge_event does not exist` / `function apply_bridge_va_credit does not exist` → migration didn't apply. Go back to §1.

---

## 4 — Register the Bridge webhook endpoint

In the Bridge dashboard for the **sandbox** environment first:

1. Settings → Webhooks → Add endpoint.
2. URL: `https://orwrcpwsffjlvzuraxjc.functions.supabase.co/bridge-webhook`
3. Copy the **per-endpoint PEM public key** Bridge issues.
4. On the Supabase project, set the secret:
   ```bash
   supabase secrets set BRIDGE_WEBHOOK_PUBLIC_KEY="$(cat /tmp/bridge_sandbox_pubkey.pem)" \
     --project-ref $PROJECT
   ```
5. Subscribe to event types you'll exercise in §6 (at minimum: `customer.*`,
   `kyc_link.*`, `virtual_account.*`, `wallet.*`, `transfer.*`).

When sandbox smoke is signed off, repeat for the live environment with a
**different** per-endpoint public key. **Do not reuse the sandbox key.**

---

## 5 — Remove deployed-only legacy functions

Per `MAPLERAD_REMOVAL_CHECKLIST.md`. Run **after** §3 so Bridge
replacements are already in place and any stale caller fails loudly.

The deployed-only Maplerad surface splits into three groups, treated
differently:

### 5.A — DELETE (no client caller, no source-tree backing)

These have no replacement in source and the client no longer calls
them. Permanent removal.

```bash
PROJECT=orwrcpwsffjlvzuraxjc

# Maplerad-only infrastructure
for fn in maplerad-webhook enroll-customer-full enroll-maplerad-customer \
          backfill-maplerad-customers kyc-debug-maplerad kyc-sync-pending \
          query-kyc-status; do
  supabase functions delete $fn --project-ref $PROJECT
done

# Cards (client short-circuits to cards_coming_soon at the API layer)
for fn in create-card get-cards get-card-transactions withdraw-card \
          freeze-card unfreeze-card terminate-card get-card-charges \
          mock-card-transaction; do
  supabase functions delete $fn --project-ref $PROJECT
done

# Virtual accounts / dynamic accounts / counterparty writes
for fn in create-virtual-account create-usd-account create-dynamic-account \
          create-counterparty get-account-counterparties; do
  supabase functions delete $fn --project-ref $PROJECT
done

# Transfer write paths (no client caller)
for fn in transfer usd-transfer stablecoin-transfer; do
  supabase functions delete $fn --project-ref $PROJECT
done

# Stablecoin write paths
for fn in generate-address update-offramp; do
  supabase functions delete $fn --project-ref $PROJECT
done

# Mobile money / KYC writes / one-shots / mocks
for fn in mobile-money-collect verify-momo-otp verify-bvn \
          provision-user-account bootstrap-mark-ngn \
          Onboarding_welcome_function make-server-b83881a1 \
          mock-collection-transaction; do
  supabase functions delete $fn --project-ref $PROJECT
done
```

### 5.B — REDEPLOY as `410 provider_removed` (handled by §3 already)

These are kept deployed but their handler now returns `410` with
`code: 'provider_removed'`. **No action needed in §5** — they were
already deployed in §3 from the vendored stub source. Listed here so
operators understand the post-§5 state:

| Slug | Reason kept deployed (vs deleted) |
|---|---|
| `kyc-submit` | Stale admin tooling may still call it; 410 fails loud. |
| `sync-users-to-maplerad` | Any leftover cron should be unscheduled separately; 410 protects against accidental retriggers. |
| `borderpay-transfer` | Old client builds in the wild may still reach this. |
| `get-fx-rates` | Old client builds. |
| `get-momo-providers` | Old client builds. |
| `provisioning-request` | Old client builds. |
| `fund-card` | Returns `501 cards_coming_soon` (not 410). Same reasoning. |

To delete these later (e.g. once analytics confirms no traffic for 30
days), run the same `supabase functions delete <slug>` pattern.

### 5.C — HOLD (read-only legacy endpoints; pending admin-tooling audit)

These read existing data. The client still depends on at least one of
each. Do **not** delete in this pass; flag for a follow-up after the
admin-tooling audit:

- `check-account-status`
- `get-account-rails`
- `get-counterparty` (singular read)
- `verify-transfer`
- `get-transfers`
- `get-all-transactions`
- `get-address`
- `get-fx-history`

### 5.D — Verification

```bash
# Confirm 5.A targets are gone.
supabase functions list --project-ref $PROJECT \
  | grep -iE 'maplerad-webhook|enroll-customer-full|enroll-maplerad-customer|backfill-maplerad-customers|kyc-debug-maplerad|kyc-sync-pending|query-kyc-status|^create-card |get-cards |get-card-transactions|withdraw-card|freeze-card|unfreeze-card|terminate-card|get-card-charges|mock-card-transaction|create-virtual-account|create-usd-account|create-dynamic-account| transfer | usd-transfer | stablecoin-transfer|generate-address|update-offramp|mobile-money-collect|verify-momo-otp|verify-bvn|provision-user-account|bootstrap-mark-ngn|Onboarding_welcome_function|make-server-b83881a1|mock-collection-transaction' \
  || echo '5.A deletions: clean'

# Confirm 5.B stubs are still deployed.
supabase functions list --project-ref $PROJECT \
  | grep -E '^(kyc-submit|sync-users-to-maplerad|borderpay-transfer|get-fx-rates|get-momo-providers|provisioning-request|fund-card)\b' \
  | wc -l
# Expected: 7
```

---

## 6 — Sandbox smoke (sk-test- only)

**Do not use the live key for any step here.** Set `BRIDGE_API_KEY`
secret to the sandbox value for the duration of §6, then restore live
afterwards.

> ⚠ **THIS TEMPORARILY MAKES ALL DEPLOYED BRIDGE FUNCTIONS USE SANDBOX
> CREDENTIALS.** Do not run §6 while live Bridge traffic is possible —
> i.e. confirm with the CTO that no live customer can initiate KYC, VA,
> wallet, or transfer creation during the smoke window, and that no live
> Bridge webhook is in flight. The default-provider flip in §2 already
> routes new signups to Bridge; pause new signups for the smoke window
> if needed.

`supabase secrets list` does not reveal secret values — only names.
You **must** source the sandbox key from your secure vault / local
shell, never from the Supabase API. Recommended pattern:

```bash
# In a SECURE local shell — never log this value, never commit it.
export BRIDGE_API_KEY_SANDBOX_VALUE='sk-test-...'   # from 1Password / vault

# Swap the project's Bridge key to sandbox for the smoke window.
supabase secrets set BRIDGE_API_KEY="$BRIDGE_API_KEY_SANDBOX_VALUE" \
  --project-ref $PROJECT

# Confirm the new prefix without printing the secret (bridge-ping will
# echo only key_prefix, never the full value).
unset BRIDGE_API_KEY_SANDBOX_VALUE
```

When §6 is complete and CTO has signed off the smoke evidence (see §7),
restore the live key — again from your secure vault, never from any
Supabase API:

```bash
export BRIDGE_API_KEY_LIVE_VALUE='sk-live-...'      # from 1Password / vault
supabase secrets set BRIDGE_API_KEY="$BRIDGE_API_KEY_LIVE_VALUE" \
  --project-ref $PROJECT
unset BRIDGE_API_KEY_LIVE_VALUE
```

Run `bridge-ping` (§6.1) again after each swap and confirm `key_kind`
matches the environment you intended (`sandbox` vs `live`).

Create a dedicated test user via the existing signup endpoint
(`smoke+<timestamp>@borderpaytest.example`) and capture the JWT.
Set:

```bash
SUPA=https://${PROJECT}.functions.supabase.co
JWT=<user JWT>
ADMIN_JWT=<an admin JWT for bridge-ping>
```

### 6.1 — `bridge-ping` reachability (admin only)

```bash
curl -s -X POST "$SUPA/bridge-ping" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H 'Content-Type: application/json' \
  -d '{}' | jq
```

Expected:
```json
{ "ok": true, "stage": "reachable", "status": 200,
  "key_prefix": "sk-test…", "key_kind": "sandbox",
  "base_url": "https://api.bridge.xyz",
  "request_id": "<bridge req id>", "latency_ms": <int>,
  "sample_count": 0 }
```

Failure modes:
- `key_kind: "live"` → wrong key, abort.
- `status: 401` → Bridge rejected key, fix secret.
- `network` stage → Supabase egress / Bridge outage.

### 6.2 — Individual KYC lazy flow

User has no `bridge_customer_id` yet.

```bash
curl -s -X POST "$SUPA/bridge-kyc-link" \
  -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d '{"redirect_url":"https://app.borderpayafrica.com/onboarding/kyc-complete"}' | jq
```

Expected: `success: true, data: { link_id, link_url, expires_at }`.

Verify side effects:

```sql
select bridge_customer_id, bridge_kyc_status, bridge_kyc_link_id is not null as link_persisted
from public.user_profiles
where email = '<smoke user email>';
```

Expected:
- `bridge_customer_id` not null (lazy-created)
- `bridge_kyc_status` = `'pending'`
- `link_persisted` = true

Open `link_url` in a browser, complete the sandbox KYC (Bridge sandbox
provides synthetic "approved" path). Wait for the webhook.

### 6.3 — Webhook ingest

```sql
select event_id, event_type, signature_ok, processing_status, queued_at is not null as enqueued
from public.bridge_webhook_events
where received_at > now() - interval '5 minutes'
order by received_at desc;
```

Expected:
- New row(s) with `signature_ok = true`.
- `processing_status` transitions `received → queued → completed` once
  the worker processes.

If `signature_ok = false`: check `BRIDGE_WEBHOOK_PUBLIC_KEY` PEM is the
**per-endpoint** key from §4, not a generic Bridge key.

### 6.4 — Worker processed the KYC event

```sql
select bridge_kyc_status, bridge_kyc_completed_at, kyc_status
from public.user_profiles
where email = '<smoke user email>';
```

Expected:
- `bridge_kyc_status = 'approved'`
- `bridge_kyc_completed_at` not null
- `kyc_status = 'verified'`

### 6.5 — USD virtual account

```bash
curl -s -X POST "$SUPA/bridge-virtual-account" \
  -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d '{"currency":"USD"}' | jq
```

Expected: `success: true, data: { virtual_account_id, account_number?, routing_number?, … }`.

Verify the wallets-mirror row was written:

```sql
select bridge_virtual_account_id, currency, provider, asset_type
from public.wallets
where user_id = (select id from auth.users where email = '<smoke user email>')
  and currency = 'USD';
```

Expected: one row, `provider = 'bridge'`, `asset_type = 'fiat_virtual_account'`.

Repeat for EUR and GBP.

### 6.6 — Stablecoin wallet

```bash
curl -s -X POST "$SUPA/bridge-wallet" \
  -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"usdc","chain":"base"}' | jq
```

Expected: `success: true, data: { wallet_id, deposit_address, symbol, chain }`.

```sql
select bridge_wallet_id, currency, chain, address, status
from public.bridge_wallets
where user_id = (select id from auth.users where email = '<smoke user email>');
```

Expected: one row, `status = 'active'`, `address` non-empty.

### 6.7 — Bridge-driven deposit → balance ledger

Trigger a sandbox deposit via the Bridge dashboard (Send funds to the
sandbox VA). Wait ~10 s for the webhook to arrive.

```sql
-- Webhook persisted + processed
select event_id, event_type, processing_status, target_entity_type, target_entity_id
from public.bridge_webhook_events
order by received_at desc limit 5;

-- Ledger row exists, idempotent on event_id
select event_id, entity_type, entity_id, amount_minor, direction, balance_after_minor
from public.bridge_balance_ledger
order by created_at desc limit 5;

-- Balance row reflects credit
select bridge_virtual_account_id, currency, available_balance_minor, pending_balance_minor
from public.bridge_virtual_account_balances
where user_id = (select id from auth.users where email = '<smoke user email>');

-- Transactions mirror (individual deposits only)
select reference, provider, type, amount, currency, status
from public.transactions
where user_id = (select id from auth.users where email = '<smoke user email>')
  and provider = 'bridge'
order by created_at desc limit 5;
```

Expected:
- One new `bridge_balance_ledger` row, `direction = 'credit'`, `balance_after_minor` matches the deposit amount in minor units.
- `bridge_virtual_account_balances.available_balance_minor` = deposit amount in minor units.
- One new `transactions` row with `provider = 'bridge'`, `reference = 'bridge:<event_id>'`, `status = 'completed'`.

**Idempotency check**: in the Bridge dashboard, replay the same webhook.
Wait ~10 s.

```sql
select count(*) from public.bridge_balance_ledger where event_id = '<event id>';
select count(*) from public.transactions where reference = 'bridge:<event id>';
select available_balance_minor from public.bridge_virtual_account_balances
where bridge_virtual_account_id = '<va id>';
```

Expected: both counts remain **1**, balance unchanged.

### 6.8 — Transfer mirror

Trigger a Bridge sandbox transfer (e.g. VA → wallet) via the dashboard or
via `bridge-transfer` if your sandbox account supports outbound.

```sql
select bridge_transfer_id, source_type, destination_type, state, amount, currency
from public.bridge_transfers
order by created_at desc limit 5;

select reference, provider, status, amount, currency
from public.transactions
where reference like 'bridge:%' and provider = 'bridge'
order by created_at desc limit 5;
```

Expected:
- `bridge_transfers` row appears with the relevant `state`.
- Mirrored `transactions` row appears; `status` reflects the Bridge state
  mapping (`succeeded → completed`, `failed|cancelled|returned → failed`,
  else `pending`).
- Subsequent state-transition webhooks update the same row (no duplicates;
  partial unique index `transactions_bridge_transfer_uniq` collapses retries).

### 6.9 — Business KYB

Run §6.2 for a business signup. Confirm:

- `business_profiles.bridge_customer_id` populated.
- `business_profiles.bridge_kyb_status` transitions `pending → approved`.
- Business VA deposit credits `bridge_virtual_account_balances` with
  `business_user_id` set, `user_id` null.
- **Does not** write a `transactions` row (business deposits skip the
  legacy mirror).

### 6.10 — Maplerad event drain (negative test)

Insert a synthetic legacy event into `pending_events` via the Supabase
SQL Editor (service-role context):

```sql
insert into public.pending_events
  (event_id, source, event_type, payload, status)
values
  ('smoke:legacy_maplerad', 'maplerad', 'collection.successful',
   '{"data":{"amount":1000,"currency":"USD"}}'::jsonb, 'queued');
```

`claim_pending_events` (verified against the live DB) claims rows where
`status in ('queued','failed') AND next_attempt_at <= now() AND
attempts < max_attempts`. The insert sets `status = 'queued'`; the
defaults of `next_attempt_at = now()` and `attempts = 0` satisfy the
other two conditions, so the row is eligible immediately.

Invoke the worker drain explicitly rather than waiting for cron — a
synthetic SQL insert may not fire the project's Database Webhook trigger
(that path is configured for actual application writes):

```bash
curl -s -X POST "$SUPA/process-pending-events" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"batch_size":10}' | jq
```

Expected response: `{"ok":true,"worker":"worker-…","claimed":N,"ok":N,"failed":0}`
with `claimed ≥ 1`.

Then verify the row:

```sql
select event_id, status, summary
from public.pending_events
where event_id = 'smoke:legacy_maplerad';
```

Expected: `status = 'completed'`, `summary` contains
`{"provider_removed":"maplerad","event_type":"collection.successful",
"note":"Maplerad has been removed; event dropped without side effects."}`.

**Confirm zero side effects**: no `wallets.balance` change, no
`bridge_balance_ledger` row, no `transactions` row inserted for that
event.

```sql
-- All three should return 0.
select count(*) from public.bridge_balance_ledger
 where event_id = 'smoke:legacy_maplerad';
select count(*) from public.transactions
 where reference = 'bridge:smoke:legacy_maplerad';
-- A wallets.balance baseline check is the operator's responsibility;
-- compare before/after rows for the smoke user against the synthetic event.
```

### 6.11 — Unknown-source negative test

```sql
insert into public.pending_events
  (event_id, source, event_type, payload, status)
values
  ('smoke:unknown_provider', 'futureco', 'some.event', '{}'::jsonb, 'queued');
```

Drain explicitly as in §6.10:

```bash
curl -s -X POST "$SUPA/process-pending-events" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"batch_size":10}' | jq
```

Expected after drain: `status = 'completed'`, `summary` contains
`{"unknown_source":"futureco","event_type":"some.event"}`. No side
effects (same three count(*) checks as 6.10).

---

## 7 — Post-smoke gate

> ⚠ **DO NOT rotate `BRIDGE_API_KEY` back to the live `sk-live-…`
> value, and DO NOT register the live Bridge webhook endpoint, until
> the CTO has reviewed and signed off the captured sandbox smoke
> evidence from §6 in writing.** Steps 7.4 and 7.5 below are gated on
> that sign-off — they describe the actions to perform AFTER it has been
> received, not before.

Capture the §6 evidence in a shared doc:

- §6.1 — `bridge-ping` response (`status`, `key_kind: sandbox`, `latency_ms`, `request_id`).
- §6.2–6.4 — KYC flow: row state before/after, webhook event id, worker summary.
- §6.5–6.6 — VA + wallet row inserts + Bridge response payloads.
- §6.7 — deposit ledger row, balance row, transactions mirror row, idempotency replay (counts unchanged).
- §6.8 — transfer mirror state transitions.
- §6.9 — business KYB row + balance (no `transactions` mirror).
- §6.10 — Maplerad terminal drain (no side effects).
- §6.11 — unknown-source terminal drain (no side effects).

### 7.1 — Replay-attack check

```bash
curl -X POST "$SUPA/bridge-webhook" \
  -H 'X-Webhook-Signature: t=1000,v0=AAAA' \
  -d '{}' -i | head -3
```

Expected: `HTTP/1.1 400` body `{"error":"timestamp outside replay window"}`.

### 7.2 — Invalid-signature check

Send a payload with a current timestamp but a forged signature.

Expected: `HTTP/1.1 401` body `{"error":"invalid signature"}`. Also
verify a `bridge_webhook_events` audit row was written with
`signature_ok = false` and `processing_status = 'rejected'`.

### 7.3 — CTO sign-off checkpoint (**hard stop**)

Submit the §6 evidence + the §7.1 + §7.2 checks to the CTO. **Do not
proceed to 7.4 until you have an explicit written approval citing this
runbook §7.3.** If the CTO requests changes, redo the relevant §6
sub-steps and re-submit.

### 7.4 — Rotate to live Bridge key (only after 7.3 sign-off)

Source `BRIDGE_API_KEY_LIVE_VALUE` from the secure vault, never from a
Supabase API:

```bash
export BRIDGE_API_KEY_LIVE_VALUE='sk-live-...'
supabase secrets set BRIDGE_API_KEY="$BRIDGE_API_KEY_LIVE_VALUE" \
  --project-ref $PROJECT
unset BRIDGE_API_KEY_LIVE_VALUE
```

Re-run `bridge-ping` (§6.1) and confirm `key_kind: "live"`. If it still
shows `sandbox`, the secret didn't propagate — fix before doing
anything else.

### 7.5 — Register the live Bridge webhook endpoint (only after 7.3)

Repeat §4 on the **live** Bridge environment with a **different
per-endpoint PEM public key**. Update the Supabase secret:

```bash
export BRIDGE_WEBHOOK_PUBLIC_KEY_LIVE="$(cat /tmp/bridge_live_pubkey.pem)"
supabase secrets set BRIDGE_WEBHOOK_PUBLIC_KEY="$BRIDGE_WEBHOOK_PUBLIC_KEY_LIVE" \
  --project-ref $PROJECT
unset BRIDGE_WEBHOOK_PUBLIC_KEY_LIVE
```

Do not reuse the sandbox PEM under any circumstances.

### 7.6 — Sandbox-mode flag

```sql
update public.provider_settings
   set value = 'false'::jsonb, updated_at = now()
 where key = 'bridge.sandbox_mode';
```

**Do NOT** run §7.6 until §7.4 and §7.5 are complete and one allowlisted
real-money test signup has completed end-to-end on live keys (a
separate, smaller §6 replay with a controlled live customer). That
controlled run is out of scope for this runbook; CTO will issue a
follow-up.

---

## 8 — Re-enabling money movement (FUTURE — not in this runbook's scope)

The following remain `rails_future_state` at the client and **must stay
that way** until a dedicated chunk replaces each with a Bridge transfer
call and re-runs an equivalent §6 smoke:

- `stablecoinAPI.sendTransfer`
- `localPaymentsAPI.transfer`
- `localPaymentsAPI.borderPayTransfer`
- `usPaymentsAPI.transfer`
- `usPaymentsAPI.createCounterparty`
- `walletAPI.createVirtualAccount` for currencies outside USD/EUR/GBP
- mobile-money paths

Each requires its own runbook entry — not enabled here.

---

## 9 — Rollback

Source-level rollback is `git revert` on the remediation commits + redeploy
the prior versions. Database-level: there is no destructive migration in
this pass, so rollback only requires:

```sql
-- Optionally re-enable Maplerad routing (NOT recommended; Maplerad client
-- no longer in the codebase). This SQL is for emergency only.
update public.provider_settings
   set value = '"maplerad"'::jsonb
 where key = 'default_provider_for_new_signups';
```

Note: the worker no longer has Maplerad event handlers; rolling forward
to redeploy them requires reverting `process-pending-events` source.
Migrations applied in §1 are all additive and safe to keep even after
a rollback.

---

## 10 — Observability after deployment

```sql
-- Queue health
select status, count(*) from public.pending_events
group by status;

-- Bridge webhook ingestion
select processing_status, count(*) from public.bridge_webhook_events
where received_at > now() - interval '24 hours'
group by processing_status;

-- Stuck rows (signal for requeue_stuck_bridge_events cron)
select count(*) from public.bridge_webhook_events
where processing_status = 'received'
  and queued_at is null
  and received_at < now() - interval '5 minutes';

-- Bridge balance ledger volume
select date_trunc('hour', created_at) as h, count(*) from public.bridge_balance_ledger
where created_at > now() - interval '24 hours'
group by 1 order by 1 desc;
```

If `stuck rows` count climbs above 0 for more than 5 minutes, schedule
`requeue_stuck_bridge_events` via pg_cron:

```sql
select cron.schedule(
  'bridge-webhook-reaper',
  '*/5 * * * *',
  $$ select public.requeue_stuck_bridge_events(300, 100); $$
);
```

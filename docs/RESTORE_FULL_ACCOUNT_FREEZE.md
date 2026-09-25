# Restore the existing full account freeze

The September 22 receiving-only workspace is withdrawn using the existing
`account_status = frozen` / `account_frozen_at` contract. Released clients already
recognize this state. No mobile assets, new screen, transfer endpoint, or app build
is part of this change.

Verified customer-paused webhooks freeze the mapped profile inside the existing
`ingest_bridge_event` transaction, before acknowledgment. Business mappings use the
business profile's effective Bridge customer. Transfer or virtual-account status
events cannot freeze the customer. Invalid signatures, duplicate events, and failed
queue writes retain the existing rejection, idempotency, and rollback semantics.
Existing freeze reasons and dates survive, including fraud holds. The existing
compliance-field guard checks the caller context rather than its SECURITY DEFINER
owner, so customers cannot clear those fields themselves. Active/approval
events never clear the local freeze. There is no timed or automatic unlock.

The existing wallet-summary RPC returns `mode: locked`; no balances or receiving
instructions are returned. Existing Bridge-paused profiles still marked active,
approved, or pending KYC are moved to the existing frozen state. Other profiles and
terminal locks are unchanged. Customer payment blocks remain in place.

Apply only migration `20260925130000_restore_existing_full_account_freeze.sql` after
the isolated SQL contract test passes. Do not push unrelated historical migrations.
Verify no Bridge-paused profile retains a receiving-only eligibility status and
that the wallet-summary RPC returns locked for an authenticated synthetic subject.
The regression test also checks duplicate delivery, signature rejection, business
mapping, transaction rollback, and preservation of fraud holds.

This change moves no funds. Bridge's paused-wallet facility is for operator-led
returns, recalls, and recovery. A separate, identified case and verified source,
amount, and destination are required for an actual transfer. Moving funds into a
master wallet does not release them to a customer. The supplied guide calls for a
60-day hold before evaluating customer recovery; it does not promise automatic
release or reinstatement of payments. Never revert to the receiving-only workspace
as an operational rollback: stop the release and investigate instead.

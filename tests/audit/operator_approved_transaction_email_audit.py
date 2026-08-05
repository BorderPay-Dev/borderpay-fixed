#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
worker = (ROOT / "supabase/functions/process-pending-events/index.ts").read_text()
registry = (ROOT / "supabase/functions/_shared/email-templates/index.ts").read_text()
migration = (ROOT / "supabase/migrations/20260805103000_operator_approved_transaction_email_preferences.sql").read_text()

assert 'if (params.status === "approved")' in worker
assert 'emailApprovedTransactionOperatorsBestEffort(params)' in worker
assert '.eq("approved_transaction_emails", true)' in worker
assert 'template: "admin.approved_transaction"' in worker
assert 'ops:approved-tx:${operatorId}:${params.userId}:${params.reference}' in worker
assert 'admin.approved_transaction' in registry
assert 'approved_transaction_emails boolean not null default false' in migration
assert 'auth.uid() = admin_user_id and public.is_borderpay_admin()' in migration
print("operator approved transaction email audit passed")

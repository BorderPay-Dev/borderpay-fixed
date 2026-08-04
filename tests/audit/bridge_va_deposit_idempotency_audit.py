#!/usr/bin/env python3
"""
Bridge VA deposit idempotency audit.

Prevents duplicate VA balance credits when Bridge emits multiple webhook events
for the same deposit lifecycle, for example `funds_received` followed by
`in_review` with the same deposit_id.
"""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "supabase/functions/process-pending-events/index.ts"
DEBIT_RPC = ROOT / "supabase/migrations/20260804000000_add_apply_bridge_va_debit_function_parity.sql"


def main() -> int:
    src = WORKER.read_text(encoding="utf-8")
    if not DEBIT_RPC.is_file():
        print("bridge_va_deposit_idempotency_audit: FAIL")
        print(f"  [XX] required VA debit RPC migration is missing: {DEBIT_RPC.relative_to(ROOT)}")
        print("  Recover the exact production apply_bridge_va_debit definition; do not reconstruct live-money SQL from assumptions.")
        return 1
    debit_rpc = DEBIT_RPC.read_text(encoding="utf-8")
    checks = [
        (
            "review statuses do not mutate VA balances",
            "non_credit_activity_status" in src
            and "in_review" in src
            and "under_review" in src
            and "return;" in src.split("non_credit_activity_status", 1)[1],
        ),
        (
            "review statuses notify the user without provider copy",
            "Transaction under review" in src
            and "virtual_account_deposit_status" in src
            and "under compliance review" in src
            and "deposit_id: depositId || null" in src,
        ),
        (
            "deposit_id drives VA credit idempotency",
            "const depositId = String(d?.deposit_id" in src
            and "creditEventId" in src
            and "deposit:${depositId}" in src
            and "p_event_id:         creditEventId" in src,
        ),
        (
            "webhook event id remains traceable",
            "webhook_event_id: ev.event_id" in src
            and "credit_event_id:  creditEventId" in src,
        ),
        (
            "refund and cancel statuses do not fall into the VA credit path",
            "nonCreditStatus && nonCreditStatus !== \"approved\"" in src
            and "\"refunded\"" in src
            and "\"canceled\"" in src
            and "apply_bridge_va_debit" in src
            and "skipped: \"non_credit_activity_status\"" in src,
        ),
        (
            "VA debit RPC is idempotent and clamps projected balance at zero",
            "create or replace function public.apply_bridge_va_debit" in debit_rpc
            and "on conflict (event_id) do nothing" in debit_rpc
            and "least(coalesce(v_current, 0), p_amount_minor)" in debit_rpc
            and "greatest(coalesce(v_current, 0) - v_debited, 0)" in debit_rpc,
        ),
        (
            "transaction status emails are wired through logged send-email",
            "emailTransactionStatusBestEffort" in src
            and "business.transaction_status" in src
            and "individual.transaction_status" in src
            and "wh:tx-status:" in src,
        ),
    ]

    ok = True
    print("bridge_va_deposit_idempotency_audit:")
    for name, passed in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}")
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for _, passed in checks if passed)}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

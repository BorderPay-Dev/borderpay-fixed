#!/usr/bin/env python3
"""Deployment-blocking source regression gate for active Bridge money movement.

This gate deliberately excludes retired/dormant providers. Every listed audit
must exist and pass; missing files and skipped checks are failures.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

AUDITS = (
    # Provider ingress, authenticity, canonicalization, and reconciliation.
    "tests/audit/bridge_webhook_signature_audit.py",
    "tests/audit/bridge_event_envelope_audit.py",
    "tests/audit/bridge_ingest_event_audit.py",
    "tests/audit/bridge_ingress_canonicalization_audit.py",
    "tests/audit/webhook_transfer_reconciliation_audit.py",
    # Outbound payload, balance/compliance gates, fee-route contract.
    "tests/audit/bridge_core_contract_audit.py",
    "tests/audit/bridge_transfer_balance_gate_audit.py",
    "tests/audit/crypto_send_balance_gate_audit.py",
    "tests/audit/crypto_to_crypto_route_fee_audit.py",
    "tests/audit/frozen_account_gate_audit.py",
    # Debit/credit direction, idempotency, lifecycle projection.
    "tests/audit/transaction_direction_contract_audit.py",
    "tests/audit/bridge_wallet_activity_projection_audit.py",
    "tests/audit/bridge_va_deposit_idempotency_audit.py",
    "tests/audit/bridge_liquidation_drain_projection_audit.py",
    "tests/audit/bridge_va_projection_guard_audit.py",
    # One projection/cache for balances, totals, activity, and notifications.
    "tests/audit/financial_engine_drift_prevention_audit.py",
    "tests/audit/financial_projection_realtime_audit.py",
    "tests/audit/financial_snapshot_cache_consistency_audit.py",
    "tests/audit/dashboard_spendable_wallet_chips_audit.py",
    "tests/audit/notification_badge_fastpaint_audit.py",
    # Money-in/out receipts and idempotent email routing.
    "tests/audit/bridge_wallet_direct_deposit_email_audit.py",
    "tests/audit/bridge_va_refund_email_audit.py",
    "tests/audit/money_in_email_template_routing_audit.py",
    "tests/audit/money_in_receipt_currency_mapping_audit.py",
    "tests/audit/webhook_email_templates_audit.py",
    "tests/audit/email_p0_logged_path_audit.py",
)


def main() -> int:
    failures: list[str] = []
    for relative in AUDITS:
        path = ROOT / relative
        if not path.is_file():
            failures.append(f"{relative}: missing required audit")
            print(f"[FAIL] {relative}: missing")
            continue
        result = subprocess.run(
            ["python3", str(path)],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        output = "\n".join(part for part in (result.stdout.strip(), result.stderr.strip()) if part)
        if result.returncode != 0 or "SKIP" in output.upper():
            failures.append(f"{relative}:\n{output[-3000:]}")
            print(f"[FAIL] {relative}")
        else:
            print(f"[PASS] {relative}")

    if failures:
        print("\nmoney_movement_regression_gate: FAIL")
        for failure in failures:
            print(f"\n---\n{failure}")
        return 1
    print(f"\nmoney_movement_regression_gate: PASS ({len(AUDITS)} required audits)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""
Flutterwave billing/payout schema audit — PR1 (SCHEMA PROPOSAL ONLY).

This PR ships a migration FILE plus this audit. The migration is NOT applied,
no edge function is deployed, no provider call is possible, no UI changes, no
flag flip. The audit asserts the proposal is additive, safe, RLS-protected,
idempotent, and free of the explicitly out-of-scope concerns.

Invariants (fail closed):

  Additive / non-destructive
  (A1) Every CREATE TABLE uses `create table if not exists`.
  (A2) No destructive or mutating DDL/DML: no DROP TABLE, no DROP COLUMN,
       no ALTER TABLE of an existing table to remove/retype, no DELETE,
       no UPDATE, no TRUNCATE. (DROP POLICY/DROP TRIGGER before re-create is
       the house idempotent-create idiom and is allowed.)

  Tables present
  (T1) All six proposed tables are created:
       flutterwave_customers, billing_subscriptions, billing_events,
       payout_intents, payout_events  (+ at least these).

  RLS
  (R1) Every new table has `enable row level security`.
  (R2) Every new table has an admin-read policy via is_borderpay_admin().

  Idempotency
  (I1) billing_subscriptions unique on flutterwave_subscription_ref.
  (I2) billing_events unique on event_id.
  (I3) payout_intents unique on idempotency_key.

  Out-of-scope exclusions (the heart of the CTO corrections)
  (X1) No yield/USDB-yield/APY/earn/interest table or column.
  (X2) No money-movement / transfer-executing SQL function
       (no create function ... that performs a transfer/payout).
  (X3) No provider secret / api key referenced in the migration.
  (X4) No flag flip (no TRANSFERS_LIVE / EXTERNAL_ACCOUNTS_LIVE here).

Non-runtime: parses the SQL file as text. No DB connection, no apply, no
provider call.

Run: python3 tests/audit/flutterwave_schema_audit.py   (exit 0 = pass)
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGR = ROOT / "supabase" / "migrations" / "20260601_flutterwave_billing_payout_schema.sql"

NEW_TABLES = [
    "flutterwave_customers",
    "billing_subscriptions",
    "billing_events",
    "payout_intents",
    "payout_events",
]


def main() -> int:
    if not MIGR.is_file():
        print(f"FAIL: migration file not found at {MIGR}")
        return 1
    raw = MIGR.read_text(encoding="utf-8")
    # Strip line comments so prose mentioning forbidden words doesn't trip checks.
    code = re.sub(r"(?m)--.*$", "", raw)
    low = code.lower()

    checks: list[tuple[str, bool, str]] = []

    # A1 — every create table is IF NOT EXISTS
    create_tables = re.findall(r"create\s+table\s+(if\s+not\s+exists\s+)?", low)
    all_ine = bool(create_tables) and all(g.strip() for g in create_tables)
    checks.append(("A1 every CREATE TABLE is IF NOT EXISTS", all_ine,
                   "found a CREATE TABLE without IF NOT EXISTS"))

    # A2 — no destructive/mutating statements
    forbidden = {
        "drop table": r"\bdrop\s+table\b",
        "drop column": r"\bdrop\s+column\b",
        "truncate": r"\btruncate\b",
        "delete from": r"\bdelete\s+from\b",
        "update (DML)": r"\bupdate\s+public\.",
        "alter...drop": r"\balter\s+table\b[^;]*\bdrop\b",
        "alter...type": r"\balter\s+table\b[^;]*\balter\s+column\b[^;]*\btype\b",
    }
    destructive = [name for name, pat in forbidden.items() if re.search(pat, low)]
    checks.append(("A2 no destructive/mutating DDL/DML", not destructive,
                   f"found: {destructive}"))

    # T1 — all new tables created
    for t in NEW_TABLES:
        checks.append((f"T1 creates public.{t}",
                       bool(re.search(rf"create\s+table\s+if\s+not\s+exists\s+public\.{t}\b", low)),
                       f"missing create for {t}"))

    # R1 — RLS enabled per table
    for t in NEW_TABLES:
        checks.append((f"R1 RLS enabled on {t}",
                       bool(re.search(rf"alter\s+table\s+public\.{t}\s+enable\s+row\s+level\s+security", low)),
                       f"RLS not enabled on {t}"))

    # R2 — admin-read policy per table
    for t in NEW_TABLES:
        # an admin policy referencing is_borderpay_admin() on this table
        seg = low.split(f"public.{t}")
        has_admin = ("is_borderpay_admin()" in low) and \
                    bool(re.search(rf"admin_read_all_{t}\b", low))
        checks.append((f"R2 admin-read policy on {t}", has_admin,
                       f"no admin_read_all_{t} / is_borderpay_admin() policy"))

    # I1..I3 idempotency uniques
    checks.append(("I1 billing_subscriptions unique(flutterwave_subscription_ref)",
                   bool(re.search(r"unique\s*\(\s*flutterwave_subscription_ref\s*\)", low)),
                   "missing unique on flutterwave_subscription_ref"))
    checks.append(("I2 billing_events unique(event_id)",
                   bool(re.search(r"unique\s*\(\s*event_id\s*\)", low)),
                   "missing unique on event_id"))
    checks.append(("I3 payout_intents unique(idempotency_key)",
                   bool(re.search(r"unique\s*\(\s*idempotency_key\s*\)", low)),
                   "missing unique on idempotency_key"))

    # X1 — no yield concepts (check code, not comments)
    yield_terms = [t for t in ["yield", "usdb_yield", "apy", "earn", "interest", "reward"]
                   if re.search(rf"\b{t}\b", low)]
    checks.append(("X1 no yield/USDB-yield concepts in schema", not yield_terms,
                   f"found yield terms: {yield_terms}"))

    # X2 — no money-movement function
    checks.append(("X2 no money-movement SQL function",
                   not re.search(r"create\s+(or\s+replace\s+)?function", low),
                   "migration defines a function (should be schema-only)"))

    # X3 — no provider secrets/keys
    secret_terms = [t for t in ["secret_key", "api_key", "flw_sec", "flwsk", "bearer "]
                    if t in low]
    checks.append(("X3 no provider secret/api key in migration", not secret_terms,
                   f"found secret-like tokens: {secret_terms}"))

    # X4 — no flag flips
    checks.append(("X4 no flag flip (TRANSFERS_LIVE/EXTERNAL_ACCOUNTS_LIVE)",
                   not re.search(r"transfers_live|external_accounts_live", low),
                   "flag identifier present in migration"))

    print("flutterwave_schema_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

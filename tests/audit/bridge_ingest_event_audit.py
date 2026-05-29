#!/usr/bin/env python3
"""
bridge_ingest_event_audit — structural audit of the ingest_bridge_event fix
migration (20260529_bridge_ingest_event_webhook_logs_parent.sql).

Proves the queue contract is preserved rather than cut around:
  1. ingest_bridge_event inserts into public.webhook_logs;
  2. the webhook_logs insert occurs BEFORE the pending_events insert;
  3. both the webhook_logs and pending_events inserts use the SAME queue id
     ('bridge:' || p_event_id);
  4. the migration does NOT drop the FK (pending_events_event_id_fkey) and does
     not drop/alter any constraint.

Fails closed: any regression (missing parent insert, wrong order, mismatched
id, or sneaking in a constraint drop) breaks the audit.

Run: python3 tests/audit/bridge_ingest_event_audit.py
Exit 0 = pass, 1 = fail.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "supabase", "migrations",
                   "20260529_bridge_ingest_event_webhook_logs_parent.sql")


def main() -> int:
    if not os.path.exists(SRC):
        print(f"bridge_ingest_event_audit: migration not found at {SRC}")
        return 1
    sql = open(SRC, encoding="utf-8").read().lower()

    # Locate the two inserts within the function.
    wl = re.search(r"insert\s+into\s+public\.webhook_logs\b", sql)
    pe = re.search(r"insert\s+into\s+public\.pending_events\b", sql)

    # S3: both inserts reference the same queue id 'bridge:' || p_event_id.
    # Pull the VALUES id expression near each insert.
    wl_uses_queue_id = bool(re.search(
        r"insert\s+into\s+public\.webhook_logs\b.*?'bridge:'\s*\|\|\s*p_event_id", sql, re.S))
    pe_uses_queue_id = bool(re.search(
        r"insert\s+into\s+public\.pending_events\b.*?'bridge:'\s*\|\|\s*p_event_id", sql, re.S))

    # S4: no constraint drops anywhere in the migration.
    drops_fk = bool(re.search(r"drop\s+constraint", sql)) or \
        ("pending_events_event_id_fkey" in sql and "drop" in sql.split("pending_events_event_id_fkey")[0][-40:])
    drops_any = bool(re.search(r"\bdrop\s+(constraint|table|index|trigger|policy)\b", sql))

    checks = [
        ("S0 targets ingest_bridge_event via CREATE OR REPLACE",
         bool(re.search(r"create\s+or\s+replace\s+function\s+public\.ingest_bridge_event", sql)),
         "expected CREATE OR REPLACE FUNCTION public.ingest_bridge_event"),

        ("S1 inserts into public.webhook_logs",
         wl is not None,
         "no insert into public.webhook_logs found"),

        ("S2 webhook_logs insert is BEFORE pending_events insert",
         (wl is not None and pe is not None and wl.start() < pe.start()),
         "webhook_logs parent must be inserted before pending_events"),

        ("S3a webhook_logs insert uses 'bridge:' || p_event_id",
         wl_uses_queue_id,
         "webhook_logs insert must key on 'bridge:' || p_event_id"),

        ("S3b pending_events insert uses 'bridge:' || p_event_id",
         pe_uses_queue_id,
         "pending_events insert must key on 'bridge:' || p_event_id"),

        ("S4a migration does NOT drop the FK / any constraint",
         not drops_fk,
         "must not drop pending_events_event_id_fkey"),

        ("S4b migration drops no table/index/trigger/policy/constraint",
         not drops_any,
         "migration must be additive to the function only"),

        ("S5 retry-safe webhook_logs insert (on conflict do nothing)",
         bool(re.search(r"insert\s+into\s+public\.webhook_logs\b.*?on\s+conflict\s*\(\s*event_id\s*\)\s*do\s+nothing", sql, re.S)),
         "expected on conflict (event_id) do nothing on the webhook_logs insert"),
    ]

    print("bridge_ingest_event_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

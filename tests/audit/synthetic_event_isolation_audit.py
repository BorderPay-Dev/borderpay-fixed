#!/usr/bin/env python3
"""Structural audit for synthetic event isolation boundary."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "supabase/functions/process-pending-events/index.ts"
ING = ROOT / "supabase/functions/bridge-test-webhook/index.ts"

worker = SRC.read_text(encoding="utf-8") if SRC.exists() else ""
ingest = ING.read_text(encoding="utf-8") if ING.exists() else ""

checks = []
checks.append(("SYN1 worker supports bridge_test source", 'case "bridge_test"' in worker))
checks.append(("SYN2 synthetic mode kill switch present", "SYNTHETIC_EVENTS_ENABLED" in worker and "synthetic_mode_disabled" in worker))
checks.append(("SYN3 synthetic dry-run handler exists", "processBridgeTestEvent" in worker and "financial_write_blocked" in worker))
checks.append(("SYN4 synthetic ingress function exists", "bridge-test-webhook" in str(ING.parent) and "queue_event_id" in ingest))
checks.append(("SYN5 ingress uses canonical ingest RPC", 'rpc("ingest_bridge_event"' in ingest))
checks.append(("SYN6 ingress requires auth token", "BRIDGE_TEST_WEBHOOK_TOKEN" in ingest and "unauthorized" in ingest))
checks.append(("SYN7 ingress has no direct lifecycle table writes", '.from("pending_events")' not in ingest and '.from("bridge_webhook_events")' not in ingest))

bad = []
for name, ok in checks:
    if not ok:
        bad.append(name)

print("synthetic_event_isolation_audit:")
for name, ok in checks:
    print(f"  {'PASS' if ok else 'FAIL'} {name}")

if bad:
    print("\nFailures:")
    for b in bad:
        print(f" - {b}")
    sys.exit(1)

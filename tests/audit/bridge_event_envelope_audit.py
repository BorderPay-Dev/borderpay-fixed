#!/usr/bin/env python3
"""
bridge_event_envelope_audit — structural audit of the Bridge event payload
parsing in process-pending-events.

Why
---
Bridge's webhook envelope is FLAT:
  { event_id, event_type, event_category, event_object_id, event_object,
    event_object_status, ... }
The entity (customer / kyc_link / virtual_account / wallet / transfer) is
`event_object`; its own id is `event_object_id`; its status is
`event_object_status`. There is no `data` wrapper and no top-level customer_id.

The worker originally read `ev.payload?.data ?? ev.payload`, so every handler
failed with "missing id" / "missing customer id" once events finally reached it
(after the signature, FK, and worker_url fixes). That left an approved customer
stuck pending.

These invariants fail closed: every Bridge handler must read the event_object
envelope (with a data/bare fallback), and the bare-payload form must not return.

Run: python3 tests/audit/bridge_event_envelope_audit.py
Exit 0 = pass, 1 = fail.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "supabase", "functions", "process-pending-events", "index.ts")

# Bridge entity handlers that consume event payloads.
HANDLERS = [
    "handleBridgeKycKyb",
    "handleBridgeCustomerStatus",
    "handleBridgeVirtualAccount",
    "handleBridgeWallet",
    "handleBridgeTransfer",
    "handleBridgeExternalAccount",
]

ENVELOPE = "ev.payload?.event_object ?? ev.payload?.data ?? ev.payload"
OLD_BARE = "ev.payload?.data ?? ev.payload;"  # the pre-fix shape (note trailing ;)


def main() -> int:
    if not os.path.exists(SRC):
        print(f"bridge_event_envelope_audit: source not found at {SRC}")
        return 1
    code = open(SRC, encoding="utf-8").read()

    checks = []

    # S1: each handler resolves `d` from event_object first.
    for h in HANDLERS:
        m = re.search(re.escape(h) + r"\(ev: PendingEvent\)[^{]*\{(.*?)\n\}", code, re.S)
        body = m.group(1) if m else ""
        checks.append((
            f"S1 {h} reads event_object envelope",
            ENVELOPE in body,
            f"{h} must set d from `{ENVELOPE}`",
        ))

    # S2: at least one envelope-aware d-assignment per handler.
    checks.append((
        "S2 envelope-aware payload reads for all handlers",
        code.count(ENVELOPE) >= len(HANDLERS),
        f"expected >= {len(HANDLERS)} envelope reads, found {code.count(ENVELOPE)}",
    ))

    # S3: no handler left on the old bare `ev.payload?.data ?? ev.payload;` form.
    # (The envelope line ends with `ev.payload;` too, so only count lines that
    #  assign d directly from the bare form.)
    bare_lines = re.findall(r"const d: any = ev\.payload\?\.data \?\? ev\.payload;", code)
    checks.append((
        "S3 no bare-payload regression",
        len(bare_lines) == 0,
        f"found {len(bare_lines)} handler(s) still on bare `payload?.data ?? payload`",
    ))

    # S4: id/status hardening — event_object_id and event_object_status used.
    checks.append((
        "S4a uses event_object_id for entity id",
        "ev.payload?.event_object_id" in code,
        "expected event_object_id fallback in id extraction",
    ))
    checks.append((
        "S4b uses event_object_status for status",
        "ev.payload?.event_object_status" in code,
        "expected event_object_status fallback in status extraction",
    ))

    print("bridge_event_envelope_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

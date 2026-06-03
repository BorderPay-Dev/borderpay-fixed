#!/usr/bin/env python3
"""
Webhook-email REASON HYGIENE audit (hard).

Bridge exposes developer/internal rejection detail that must NEVER reach a
customer email. This audit guards the worker email path so a customer-facing
`reason` can only ever be a customer-safe value — never raw provider text.

Forward-compatible:
  * v1 (current): the worker passes NO `reason` prop at all → trivially safe.
  * later: when a reviewed `extractCustomerSafeReason()` lands, any `reason`
    passed to a template MUST come only from it, with a generic fallback.

Either way, the forbidden-source invariants below always hold.

Invariants (fail closed):

  (RH1) the worker never references developer/internal reason fields
        (developer_reason / developer_rejection_reason / internal_reason).
  (RH2) the worker never reads endorsement-level / `issues` detail.
  (RH3) no raw payload reason is passed to a template (no `reason: <payload var>`).
  (RH4) reason population is gated:
          - if extractCustomerSafeReason() exists, every template `reason` comes
            from it AND a generic customer-safe fallback string is defined;
          - else (v1) the email helper passes NO `reason` prop at all.

Non-runtime: parses source as text. No deploy, no DB, no network.

Run: python3 tests/audit/webhook_email_reason_hygiene_audit.py   (exit 0 = pass)
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "supabase" / "functions" / "process-pending-events" / "index.ts"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def sl(s: str, start: str, end: str) -> str:
    i = s.find(start)
    if i < 0:
        return ""
    j = s.find(end, i + len(start))
    return s[i:j] if j > i else s[i:]


def main() -> int:
    src    = read(WORKER)
    low    = src.lower()
    helper = sl(src, "async function emailKycDecisionBestEffort", "interface PendingEvent")

    checks: list[tuple[str, bool, str]] = []

    # RH1 — no developer/internal reason fields anywhere in the worker.
    rh1 = ("developer_reason" not in low
           and "developer_rejection_reason" not in low
           and "internal_reason" not in low)
    checks.append(("RH1 no developer/internal reason fields referenced", rh1,
                   "worker must not reference developer_reason / developer_rejection_reason / internal_reason"))

    # RH2 — no endorsement-level / issues detail read.
    rh2 = ("issues" not in low and "endorsement" not in low)
    checks.append(("RH2 no endorsement/issues detail referenced", rh2,
                   "worker must not read endorsement-level or `issues` detail"))

    # RH3 — no raw payload reason passed to a template.
    raw_reason = re.search(r"reason:\s*(d\b|d\?|d\.|payload|ev\.payload|ev\.payload\?)", src)
    rh3 = raw_reason is None
    checks.append(("RH3 no raw payload reason passed to a template", rh3,
                   f"raw payload reason assignment found: {raw_reason.group(0) if raw_reason else ''}"))

    # RH4 — reason population gated (extractor-or-none).
    has_extractor = "extractCustomerSafeReason" in src
    helper_has_reason = "reason:" in helper
    if has_extractor:
        rh4 = (helper_has_reason is False or "extractCustomerSafeReason(" in helper) \
              and ("extractCustomerSafeReason(" in helper) \
              and re.search(r'GENERIC[_A-Z]*REASON|"Your information could not be verified', src) is not None
        detail = "with an extractor present, template reason must come only from it + a generic fallback must exist"
    else:
        rh4 = not helper_has_reason
        detail = "v1 (no extractor): the email helper must pass NO reason prop"
    checks.append(("RH4 reason population gated (extractor-or-none)", rh4, detail))

    print("webhook_email_reason_hygiene_audit:")
    ok = True
    for name, passed, det in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {det}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

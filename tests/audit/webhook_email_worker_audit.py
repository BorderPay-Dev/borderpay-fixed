#!/usr/bin/env python3
"""
Worker-email wiring audit (v1 — KYC/KYB decisions only).

Per docs/bridge-webhook-email-policy.md (#64). v1 wires ONLY terminal KYC/KYB
decision emails (confirmed Bridge vocabulary). VA/wallet/transfer email wiring is
intentionally absent (unconfirmed vocab; transfer also TRANSFERS_LIVE-gated).

Invariants (fail closed):

  (W1) emails fire ONLY on terminal decisions:
       - handleBridgeKycKyb: normalized approved/rejected
       - handleBridgeCustomerStatus: canonicalKyc verified/rejected
  (W2) recipient is resolved from the DB (user_profiles), never from the payload.
  (W3) suppression predicate is DB/env only: is_admin, WEBHOOK_EMAIL_SUPPRESS_LIST,
       WEBHOOK_EMAIL_SUPPRESS_DOMAINS, and unconfirmed email (auth email_confirmed_at).
  (W4) idempotency key = `wh:${ev.event_id}:${template}`.
  (W5) NO VA/wallet/transfer email wiring (only 2 call sites: kyc + customer).
  (W6) best-effort: the email helper is wrapped in try/catch and never throws;
       the customer-path resolve is also guarded.
  (W7) no direct Resend in the worker (routes only via send-email).
  (W8) templates used = individual.kyc_decision + business.kyb_decision only
       (no account_ready / transaction_notification wired in v1).
  (W9) routes through the logged send-email with the internal-token bearer.

Non-runtime: parses source as text. No deploy, no DB, no network.

Run: python3 tests/audit/webhook_email_worker_audit.py   (exit 0 = pass)
"""

from __future__ import annotations
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
    src     = read(WORKER)
    kyc     = sl(src, "async function handleBridgeKycKyb", "async function handleBridgeCustomerStatus")
    cust    = sl(src, "async function handleBridgeCustomerStatus", "const CURRENCY_SCALE")
    va      = sl(src, "async function handleBridgeVirtualAccount", "async function handleBridgeWallet")
    wallet  = sl(src, "async function handleBridgeWallet", "async function handleBridgeTransfer")
    xfer    = sl(src, "async function handleBridgeTransfer", "async function resolveOwnerFromBridgeCustomer")
    helper  = sl(src, "async function emailKycDecisionBestEffort", "// ── Bridge event router")
    recip   = sl(src, "async function resolveEmailRecipient", "async function emailKycDecisionBestEffort")

    checks: list[tuple[str, bool, str]] = []

    # W1 — terminal-only guards
    w1 = ('normalized === "approved" || normalized === "rejected"' in kyc
          and 'emailKycDecisionBestEffort(' in kyc
          and 'canonicalKyc === "verified" || canonicalKyc === "rejected"' in cust
          and 'emailKycDecisionBestEffort(' in cust)
    checks.append(("W1 emails only on terminal decisions", w1,
                   "kyc handler must gate on approved/rejected; customer handler on verified/rejected"))

    # W2 — recipient from DB only
    w2 = ("user_profiles" in recip and ".select(\"email" in recip
          and "rcpt.email" in helper
          and "to:" not in kyc and "to:" not in cust)  # no payload-built recipient in handlers
    checks.append(("W2 recipient from DB (user_profiles), not payload", w2,
                   "recipient must come from resolveEmailRecipient(user_profiles), never the payload"))

    # W3 — suppression predicate from DB/env
    w3 = ("is_admin" in recip
          and "WEBHOOK_EMAIL_SUPPRESS_LIST" in src
          and "WEBHOOK_EMAIL_SUPPRESS_DOMAINS" in src
          and "EMAIL_SUPPRESS_LIST()" in recip
          and "EMAIL_SUPPRESS_DOMAINS()" in recip
          and "getUserById" in recip and "email_confirmed_at" in recip)
    checks.append(("W3 suppression predicate from DB/env (incl. unconfirmed)", w3,
                   "must check is_admin + suppress list/domain + email_confirmed_at, all from DB/env"))

    # W4 — idempotency key
    w4 = "idempotency_key: `wh:${ev.event_id}:${template}`" in helper
    checks.append(("W4 idempotency key wh:${event_id}:${template}", w4,
                   "must pass idempotency_key = wh:${ev.event_id}:${template}"))

    # W5 — no VA/wallet/transfer email wiring; exactly 2 call sites
    call_sites = src.count("await emailKycDecisionBestEffort(")
    w5 = (call_sites == 2
          and "emailKycDecisionBestEffort" not in va
          and "emailKycDecisionBestEffort" not in wallet
          and "emailKycDecisionBestEffort" not in xfer
          and "send-email" not in va and "send-email" not in wallet and "send-email" not in xfer)
    checks.append(("W5 no VA/wallet/transfer email wiring (2 call sites)", w5,
                   f"only kyc + customer may email; found {call_sites} call sites / VA-wallet-transfer must be clean"))

    # W6 — best-effort
    w6 = ("try {" in helper and "catch (e)" in helper and "console.log" in helper
          and "catch { /* best-effort" in cust)
    checks.append(("W6 best-effort (try/catch, never throws)", w6,
                   "email helper must try/catch+log; customer path must guard resolve"))

    # W7 — no direct Resend USAGE (API host / key / SDK), ignoring prose mentions.
    low = src.lower()
    w7 = ("api.resend.com" not in low
          and "resend_api_key" not in low
          and "resend.com" not in low
          and 'from \"resend\"' not in low
          and "require('resend')" not in low)
    checks.append(("W7 no direct Resend usage in worker", w7,
                   "worker must route only through send-email, never call the Resend API/SDK"))

    # W8 — only the two confirmed templates
    w8 = ('"individual.kyc_decision"' in helper and '"business.kyb_decision"' in helper
          and "account_ready" not in src and "transaction_notification" not in src)
    checks.append(("W8 only kyc_decision + kyb_decision templates", w8,
                   "v1 must use individual.kyc_decision + business.kyb_decision only"))

    # W9 — routes through send-email with internal-token bearer
    w9 = ("/functions/v1/send-email" in helper
          and "Bearer ${SEND_EMAIL_TOKEN}" in helper
          and 'Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN")' in src)
    checks.append(("W9 routes via logged send-email w/ internal token", w9,
                   "must POST send-email with Authorization: Bearer SEND_EMAIL_INTERNAL_TOKEN"))

    print("webhook_email_worker_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

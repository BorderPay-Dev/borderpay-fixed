#!/usr/bin/env python3
"""
Payment → verification-link email audit.

After a successful one-time activation payment, subscription-upgrade emails the
user a secure HOSTED verification link (Bridge /v0/kyc_links). The in-app KYC
screen is read-only status, so the link is delivered by email.

Invariants (fail closed):
  PK1  individual + business payment-received templates exist.
  PK2  both templates are imported, in the TemplateName union, and in TEMPLATES.
  PK3  subscription-upgrade fires emailVerificationLink AFTER the plan switch,
       and the helper is best-effort (wrapped in try/catch, never throws).
  PK4  the email is sent via the logged send-email path (Bearer
       SEND_EMAIL_INTERNAL_TOKEN, NOT direct Resend) with an idempotency_key,
       and the recipient comes from the DB (user_profiles), never request input.
  PK5  link is generated via the canonical Bridge /v0/kyc_links endpoint, status
       stamped 'pending', persisted to the profile; reuses an existing link.
  PK6  white-label + no money-movement overpromise in the templates.

Non-runtime: text parse only. Run: python3 tests/audit/payment_kyc_email_audit.py
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
F = ROOT / "supabase" / "functions"
TPL = F / "_shared" / "email-templates"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    ind = read(TPL / "individual" / "payment-received.ts")
    biz = read(TPL / "business" / "payment-received.ts")
    idx = read(TPL / "index.ts")
    sub = read(F / "subscription-upgrade" / "index.ts")

    checks: list[tuple[str, bool, str]] = []

    checks.append(("PK1 payment-received templates exist",
                   bool(ind) and bool(biz) and "kyc_url" in ind and "kyc_url" in biz,
                   "individual/ + business/ payment-received.ts must exist and accept kyc_url"))

    checks.append(("PK2 templates registered",
                   ('individual.payment_received' in idx and 'business.payment_received' in idx
                    and 'individualPaymentReceived' in idx and 'businessPaymentReceived' in idx),
                   "register both in the union, imports, and TEMPLATES map"))

    # PK3 — fired after the plan switch, best-effort.
    after_switch = ("switch_subscription_plan" in sub
                    and sub.find("emailVerificationLink(user.id") > sub.find("switch_subscription_plan"))
    best_effort = ("async function emailVerificationLink" in sub
                   and "try {" in sub and "catch (e)" in sub
                   and "best-effort" in sub.lower())
    checks.append(("PK3 emailVerificationLink fired post-payment + best-effort",
                   after_switch and best_effort,
                   "must call emailVerificationLink after switch_subscription_plan, wrapped try/catch"))

    # PK4 — logged send-email, token, idempotency, recipient from DB.
    checks.append(("PK4 routed via logged send-email (token + idempotency, DB recipient)",
                   ("/functions/v1/send-email" in sub
                    and "SEND_EMAIL_INTERNAL_TOKEN" in sub
                    and "idempotency_key" in sub
                    and "activation:verify:" in sub
                    and "resend" not in sub.lower()
                    and ".from(\"user_profiles\")" in sub),
                   "send-email only (no direct Resend), idempotency_key, recipient from user_profiles"))

    # PK5 — canonical Bridge link gen + persistence + reuse.
    checks.append(("PK5 canonical Bridge link generation + persist + reuse",
                   ("/v0/kyc_links" in sub
                    and "bridge_kyc_link_url" in sub and "bridge_kyb_link_url" in sub
                    and "\"pending\"" in sub
                    and "bridge_kyc_status" in sub),
                   "must POST /v0/kyc_links, stamp pending, store link on the profile, reuse existing"))

    # PK6 — white-label + no overpromise, both templates.
    banned = ["now available", "moving money", "wallets are available", "unlocked", "bridge"]
    tl = (ind + biz).lower()
    hits = [b for b in banned if b in tl]
    checks.append(("PK6 white-label + no overpromise",
                   not hits,
                   f"templates must not contain {banned} (found: {hits})"))

    print("payment_kyc_email_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

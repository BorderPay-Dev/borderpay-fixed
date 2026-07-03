#!/usr/bin/env python3
"""
Webhook-email template audit (#64 policy — template PR, no worker wiring).

Adds the templates the webhook-email policy requires before any worker wiring:
  - individual.kyc_decision   (terminal KYC approve/reject)
  - individual.account_ready  (VA/wallet provisioned/failed)
  - business.account_ready    (VA/wallet provisioned/failed)
business.kyb_decision, business.account_activated, *.transaction_notification
already existed. These templates are INERT until the separate worker PR wires
them — purely additive, no change to existing emails.

Invariants (fail closed):

  (E1) all three new slugs are registered in index.ts (import + TemplateName
       union + TEMPLATES map).
  (E2) each new template file exports render() and renders through the shared
       layout (htmlLayout + textLayout), returning subject/html/text.
  (E3) kyc-decision handles approved+rejected (danger tone on reject);
       account-ready handles provisioned+failed (danger tone on failure).
  (E4) the existing templates remain registered (regression): 11 total.
  (E5) the new slugs match the #64 policy gaps exactly.

Non-runtime: parses source as text. No deploy, no DB, no network.

Run: python3 tests/audit/webhook_email_templates_audit.py   (exit 0 = pass)
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TPL  = ROOT / "supabase" / "functions" / "_shared" / "email-templates"
IDX  = TPL / "index.ts"

NEW = {
    "individual.kyc_decision":  TPL / "individual" / "kyc-decision.ts",
    "individual.account_ready": TPL / "individual" / "account-ready.ts",
    "business.account_ready":   TPL / "business" / "account-ready.ts",
}


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    idx = read(IDX)
    checks: list[tuple[str, bool, str]] = []

    # E1 — registered in union + map (+ a matching import)
    e1 = True
    for slug in NEW:
        in_union = f'"{slug}"' in idx
        in_map   = f'"{slug}":' in idx
        if not (in_union and in_map):
            e1 = False
    # imports for the three new renderers
    e1 = e1 and all(s in idx for s in (
        'from "./individual/kyc-decision.ts"',
        'from "./individual/account-ready.ts"',
        'from "./business/account-ready.ts"',
    ))
    checks.append(("E1 new slugs registered (import + union + map)", e1,
                   "index.ts must import + add the 3 new slugs to TemplateName and TEMPLATES"))

    # E2 — each file exports render() through the shared layout
    e2 = True
    for slug, path in NEW.items():
        src = read(path)
        ok = (bool(src)
              and "export function render(" in src
              and "htmlLayout(" in src
              and "textLayout(" in src
              and "subject" in src)
        if not ok:
            e2 = False
    checks.append(("E2 new templates export render() via shared layout", e2,
                   "each new template must export render() and use htmlLayout + textLayout"))

    # E3 — decision/outcome branches + danger tone
    kyc = read(NEW["individual.kyc_decision"])
    iar = read(NEW["individual.account_ready"])
    bar = read(NEW["business.account_ready"])
    e3 = (
        '"approved"' in kyc and '"rejected"' in kyc and 'brandTone: approved ? "default" : "danger"' in kyc
        and '"provisioned"' in iar and '"failed"' in iar and 'brandTone: ok ? "default" : "danger"' in iar
        and '"provisioned"' in bar and '"failed"' in bar and 'brandTone: ok ? "default" : "danger"' in bar
    )
    checks.append(("E3 approve/reject + provisioned/failed branches w/ danger tone", e3,
                   "kyc-decision must branch approved/rejected; account-ready must branch provisioned/failed; failures use danger tone"))

    # E4 — regression floor: templates may grow, but must not shrink below
    # the baseline set required by the webhook/email policy.
    total = len(re.findall(r'"\w+\.\w+":\s*\w', idx))
    checks.append(("E4 minimum template registry size", total >= 15,
                   f"expected at least 15 registered templates, found {total}"))

    # E5 — new slugs match the policy gaps exactly
    e5 = set(NEW.keys()) == {"individual.kyc_decision", "individual.account_ready", "business.account_ready"}
    checks.append(("E5 new slugs match #64 policy gaps", e5, "slug set drift"))

    print("webhook_email_templates_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

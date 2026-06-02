#!/usr/bin/env python3
"""
Bridge Core — architecture-contract audit (Bridge Core PR1).

This audit FREEZES the Bridge Core contract documented in
docs/bridge-core-contract.md. It introduces no behavior; it asserts the
architecture invariants stay true so future Bridge work can't silently drift.

Invariants (fail closed):

  (B1) TRANSFERS_LIVE is false (no transfer flag flip).
  (B2) EXTERNAL_ACCOUNTS_LIVE is false (no external-accounts flag flip).
  (B3) Cards remain Coming Soon (no active issue/fund path in CardsScreen).
  (B4) No USDB/yield product copy in UI (no apy/yield/interest-rate/staking/...).
       (The USDB *ticker* is allowed; yield *product* language is not.)
  (B5) Bridge external accounts are NOT labeled as African local banks
       (no NGN/KES/GHS/UGX/TZS/XAF/XOF/ZAR in the payouts/external-account UI).
  (B6) Flutterwave does NOT appear in onboarding/eligibility code paths.
  (B7) The Bridge Core contract doc exists with its key sections.

Non-runtime: parses source as text. No deploy, no DB, no network.

Run: python3 tests/audit/bridge_core_contract_audit.py   (exit 0 = pass)
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    checks: list[tuple[str, bool, str]] = []

    flags = read(ROOT / "utils" / "featureFlags.ts")
    checks.append(("B1 TRANSFERS_LIVE = false",
                   bool(re.search(r"TRANSFERS_LIVE\s*:\s*boolean\s*=\s*false", flags)),
                   "transfers must stay gated off"))
    checks.append(("B2 EXTERNAL_ACCOUNTS_LIVE = false",
                   bool(re.search(r"EXTERNAL_ACCOUNTS_LIVE\s*:\s*boolean\s*=\s*false", flags)),
                   "external accounts must stay gated off"))

    cards = read(ROOT / "components" / "cards" / "CardsScreen.tsx").lower()
    checks.append(("B3 cards remain Coming Soon",
                   ("soon" in cards and "disabled" in cards and "fund-card" not in cards),
                   "CardsScreen must stay coming-soon with no active issue/fund path"))

    # B4 — no yield-product copy in UI .tsx + email templates. USDB ticker allowed.
    yield_terms = [r"\bapy\b", r"\byield\b", r"\binterest rate\b", r"\bstaking\b",
                   r"\bannual percentage\b", r"\bearn(?:ing|ed)? interest\b",
                   r"\binterest[- ]bearing\b"]
    yield_hits: list[str] = []
    scan_files = list((ROOT / "components").rglob("*.tsx"))
    scan_files += list((ROOT / "supabase" / "functions" / "_shared" / "email-templates").rglob("*.ts"))
    for f in scan_files:
        txt = read(f).lower()
        for pat in yield_terms:
            if re.search(pat, txt):
                yield_hits.append(f"{f.relative_to(ROOT)} :: {pat}")
    checks.append(("B4 no USDB/yield product copy",
                   not yield_hits,
                   f"yield-product copy found: {yield_hits[:5]}"))

    # B5 — payouts/external-account UI must not present African local-bank options.
    afr = re.compile(r"\b(NGN|KES|GHS|UGX|TZS|XAF|XOF|ZAR)\b")
    payout_files = list((ROOT / "components" / "payouts").rglob("*.tsx"))
    afr_hits = [str(f.relative_to(ROOT)) for f in payout_files if afr.search(read(f))]
    checks.append(("B5 external accounts not African local banks",
                   not afr_hits,
                   f"African currency codes in payouts UI: {afr_hits}"))

    # B6 — Flutterwave must not appear in onboarding/eligibility code.
    onboarding = [
        ROOT / "supabase" / "functions" / "auth-signup" / "index.ts",
        ROOT / "supabase" / "functions" / "bridge-customer" / "index.ts",
        ROOT / "supabase" / "functions" / "bridge-kyc-link" / "index.ts",
        ROOT / "supabase" / "functions" / "bridge-kyb-link" / "index.ts",
        ROOT / "supabase" / "functions" / "kyc-submit" / "index.ts",
        ROOT / "supabase" / "functions" / "kyc-status" / "index.ts",
    ]
    fw_hits = [str(p.relative_to(ROOT)) for p in onboarding if "flutterwave" in read(p).lower()]
    checks.append(("B6 Flutterwave not in onboarding/eligibility",
                   not fw_hits,
                   f"Flutterwave referenced in onboarding code: {fw_hits}"))

    # B7 — contract doc present with key sections.
    doc = read(ROOT / "docs" / "bridge-core-contract.md")
    doc_ok = all(s in doc for s in [
        "Bridge is the primary eligibility layer",
        "Out of scope",
        "TRANSFERS_LIVE = false",
        "EXTERNAL_ACCOUNTS_LIVE = false",
    ])
    checks.append(("B7 contract doc present with key sections", doc_ok,
                   "docs/bridge-core-contract.md missing or incomplete"))

    print("bridge_core_contract_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

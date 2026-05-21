#!/usr/bin/env python3
"""
Bridge country-policy parity audit (round-9 P1 hardening).

Asserts three invariants. Any failure = non-zero exit. Wire into CI.

  (1) No Bridge edge function (other than the policy file itself)
      defines a country-restriction Set inline. Every country block
      must come from the shared policy.

  (2) Every Bridge edge function that touches a Bridge API call path
      (customer / KYC / KYB / wallet / virtual-account / transfer)
      imports from `bridge-country-policy.ts`. Webhook + ping are
      exempt (webhook is inbound, ping is a health check).

  (3) The frontend mirror in `utils/compliance/partnerCountryPolicy.ts`
      contains the SAME two country sets (BRIDGE_PROHIBITED_COUNTRIES,
      BRIDGE_CONTROLLED_COUNTRIES) as the backend authority. Byte-level
      content of the country code set is required to match.

Usage:
  $ python3 tests/audit/bridge_country_policy_audit.py
  PASS: bridge country policy parity audit
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
POLICY_BACKEND  = ROOT / "supabase/functions/_shared/providers/bridge-country-policy.ts"
POLICY_FRONTEND = ROOT / "utils/compliance/partnerCountryPolicy.ts"
EDGE_FUNCTIONS  = ROOT / "supabase/functions"

# Edge functions that MUST consult the shared policy.
REQUIRED_IMPORTERS = {
    "bridge-customer",
    "bridge-kyc-link",
    "bridge-kyb-link",
    "bridge-wallet",
    "bridge-virtual-account",
    "bridge-transfer",
}

# Edge functions that don't touch a Bridge customer-data API call path.
EXEMPT_FROM_IMPORT = {
    "bridge-ping",       # health probe only
    "bridge-webhook",    # inbound Bridge → us; customer already gated upstream
}


def strip_comments(src: str) -> str:
    # Remove // line comments and /* block */ comments. Good enough for TS source.
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    src = re.sub(r"^\s*//[^\n]*\n", "\n", src, flags=re.MULTILINE)
    src = re.sub(r"//[^\n]*", "", src)
    return src


def extract_set(src: str, set_name: str) -> frozenset[str]:
    """Parse `export const <set_name>: ReadonlySet<string> = new Set([...])`
    and return the set of upper-cased ISO codes."""
    pat = re.compile(
        rf"export\s+const\s+{re.escape(set_name)}[^=]*=\s*new\s+Set\s*\(\s*\[([^\]]*)\]",
        re.DOTALL,
    )
    m = pat.search(src)
    if not m:
        raise SystemExit(f"audit: could not find {set_name} in source")
    body = m.group(1)
    codes = re.findall(r'"([A-Z]{2,3})"', body)
    return frozenset(c.upper() for c in codes)


def assert_no_inline_country_sets() -> list[str]:
    """Invariant (1): no `new Set(["XX",...])` of country-like values
    anywhere under supabase/functions, except for the shared policy."""
    findings: list[str] = []
    # Country-like = two upper letters only (ISO-2). Skip currency / chain sets.
    inline_re = re.compile(r"new\s+Set\s*\(\s*\[\s*((?:\"[A-Z]{2}\"\s*,?\s*)+)\]")
    for ts in EDGE_FUNCTIONS.rglob("*.ts"):
        if ts.resolve() == POLICY_BACKEND.resolve():
            continue
        src = strip_comments(ts.read_text())
        for m in inline_re.finditer(src):
            body = m.group(1)
            codes = re.findall(r'"([A-Z]{2})"', body)
            # Filter out known-non-country two-letter sets: currencies
            # (USD/EUR/GBP), chain enums, etc. Heuristic: if any code is a
            # known restricted-country ISO (e.g. CD, IR), it's a country set.
            country_like = any(c in {
                "CD","IR","KP","RU","CU","SY","SD","SS","YE","LB","LY",
                "IQ","AF","BY","MM","SO","VE","NG","KE","ZA","GH","ET",
            } for c in codes)
            if country_like:
                # Locate line for the report.
                line = src[:m.start()].count("\n") + 1
                findings.append(f"{ts.relative_to(ROOT)}:{line}: inline country set: {codes}")
    return findings


def assert_required_imports() -> list[str]:
    """Invariant (2): every REQUIRED_IMPORTER edge function imports
    from bridge-country-policy."""
    findings: list[str] = []
    for fn_name in REQUIRED_IMPORTERS:
        index = EDGE_FUNCTIONS / fn_name / "index.ts"
        if not index.exists():
            findings.append(f"missing edge function: {fn_name}/index.ts")
            continue
        src = index.read_text()
        if "bridge-country-policy" not in src:
            findings.append(f"{fn_name}/index.ts: does not import bridge-country-policy")
    return findings


def assert_frontend_mirror() -> list[str]:
    """Invariant (3): backend and frontend Prohibited+Controlled sets match."""
    findings: list[str] = []
    backend_src  = POLICY_BACKEND.read_text()
    frontend_src = POLICY_FRONTEND.read_text()

    for name in ("BRIDGE_PROHIBITED_COUNTRIES", "BRIDGE_CONTROLLED_COUNTRIES"):
        b = extract_set(backend_src,  name)
        f = extract_set(frontend_src, name)
        if b != f:
            only_b = sorted(b - f)
            only_f = sorted(f - b)
            findings.append(
                f"{name}: backend vs frontend differ — only-backend={only_b}, only-frontend={only_f}"
            )
    return findings


def main() -> int:
    failures: list[str] = []

    f1 = assert_no_inline_country_sets()
    if f1:
        failures.append("(1) inline country sets found in bridge-* edge functions:")
        failures.extend("    " + s for s in f1)

    f2 = assert_required_imports()
    if f2:
        failures.append("(2) Bridge edge functions missing the shared policy import:")
        failures.extend("    " + s for s in f2)

    f3 = assert_frontend_mirror()
    if f3:
        failures.append("(3) backend ↔ frontend country-set drift:")
        failures.extend("    " + s for s in f3)

    if failures:
        print("FAIL: bridge country policy parity audit")
        print()
        print("\n".join(failures))
        print()
        return 1

    # Report sizes for visibility.
    backend_src = POLICY_BACKEND.read_text()
    prohibited = extract_set(backend_src, "BRIDGE_PROHIBITED_COUNTRIES")
    controlled = extract_set(backend_src, "BRIDGE_CONTROLLED_COUNTRIES")

    print("PASS: bridge country policy parity audit")
    print()
    print(f"  prohibited countries:        {len(prohibited)}")
    print(f"  controlled countries:        {len(controlled)}")
    print(f"  required-importer functions: {len(REQUIRED_IMPORTERS)}  (all import shared policy)")
    print(f"  inline country sets:         0  (in bridge-* edge functions, excluding policy file)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

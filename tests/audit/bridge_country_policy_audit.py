#!/usr/bin/env python3
"""
Bridge country-policy parity audit (round-9 + round-10 P1 hardening).

Asserts five invariants. Any failure = non-zero exit. Wire into CI.

  (1) No Bridge edge function (other than the policy file itself)
      defines a country-restriction Set inline. Every country block
      must come from the shared policy.

  (2) Every Bridge edge function that touches a Bridge API call path
      (customer / KYC / KYB / wallet / virtual-account / transfer)
      imports from `bridge-country-policy.ts`. Webhook + ping are
      exempt (webhook is inbound, ping is a health check).

  (3) The frontend mirror in `utils/compliance/partnerCountryPolicy.ts`
      contains the SAME three country sets (BRIDGE_PROHIBITED_COUNTRIES,
      BRIDGE_UNAVAILABLE_COUNTRIES, BRIDGE_CONTROLLED_COUNTRIES) as the
      backend authority. Byte-level content of the country code set is
      required to match.

  (4) Ordering: in every required-importer edge function, the
      `if (isBridgeBlocked(...))` call MUST appear before any
      idempotent / reuse early-return that consults Bridge customer or
      link state (`already_exists`, `already_approved`, `reused: true`).
      A user in a blocked country with a stale `bridge_customer_id`
      must hit the gate, not the early return.

  (5) The three tiers are disjoint — no country code appears in more
      than one of Prohibited / Unavailable / Controlled.

  (6) Bridge policy accepts ISO-3 country codes from upstream profile/KYC data
      before applying product rail gates. KEN must normalize to KE so Kenya
      cannot receive USD virtual-account rail availability.

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
    """Invariant (3): backend and frontend Prohibited+Unavailable+Controlled sets match."""
    findings: list[str] = []
    backend_src  = POLICY_BACKEND.read_text()
    frontend_src = POLICY_FRONTEND.read_text()

    for name in (
        "BRIDGE_PROHIBITED_COUNTRIES",
        "BRIDGE_UNAVAILABLE_COUNTRIES",
        "BRIDGE_CONTROLLED_COUNTRIES",
    ):
        b = extract_set(backend_src,  name)
        f = extract_set(frontend_src, name)
        if b != f:
            only_b = sorted(b - f)
            only_f = sorted(f - b)
            findings.append(
                f"{name}: backend vs frontend differ — only-backend={only_b}, only-frontend={only_f}"
            )
    return findings


def assert_gate_before_reuse() -> list[str]:
    """Invariant (4): in every required-importer edge function, the
    `if (isBridgeBlocked(...))` call comes BEFORE the first idempotent /
    reuse early-return line (`already_exists`, `already_approved`,
    `reused: true`). bridge-transfer is exempt: it has no such reuse
    path, only a `bridge_customer_id IS NOT NULL` requirement check
    (which gates IN, not out)."""
    findings: list[str] = []
    reuse_patterns = re.compile(
        r"already_exists\s*:\s*true|already_approved\s*:\s*true|reused\s*:\s*true"
    )
    gate_pattern   = re.compile(r"if\s*\(\s*isBridgeBlocked\s*\(")

    for fn_name in sorted(REQUIRED_IMPORTERS):
        index = EDGE_FUNCTIONS / fn_name / "index.ts"
        if not index.exists():
            continue
        src   = index.read_text()
        lines = src.splitlines()
        gate_line  = None
        reuse_line = None
        for i, line in enumerate(lines, start=1):
            if gate_line is None and gate_pattern.search(line):
                gate_line = i
            if reuse_line is None and reuse_patterns.search(line):
                reuse_line = i
        if reuse_line is None:
            # No reuse return — invariant vacuous for this function.
            continue
        if gate_line is None:
            findings.append(f"{fn_name}/index.ts: reuse return on L{reuse_line} but no isBridgeBlocked() call")
            continue
        if gate_line > reuse_line:
            findings.append(
                f"{fn_name}/index.ts: isBridgeBlocked() on L{gate_line} comes AFTER reuse return on L{reuse_line} "
                f"— prohibited-country user with stale state would bypass the gate"
            )
    return findings


def assert_tiers_disjoint() -> list[str]:
    """Invariant (5): no country code is in more than one tier."""
    findings: list[str] = []
    src = POLICY_BACKEND.read_text()
    p = extract_set(src, "BRIDGE_PROHIBITED_COUNTRIES")
    u = extract_set(src, "BRIDGE_UNAVAILABLE_COUNTRIES")
    c = extract_set(src, "BRIDGE_CONTROLLED_COUNTRIES")
    overlaps = {
        "prohibited ∩ unavailable": sorted(p & u),
        "prohibited ∩ controlled":  sorted(p & c),
        "unavailable ∩ controlled": sorted(u & c),
    }
    for label, codes in overlaps.items():
        if codes:
            findings.append(f"{label}: {codes}")
    return findings


def assert_iso3_normalization_and_va_gates() -> list[str]:
    """Invariant (6): frontend/backend policy must normalize ISO-3 profile
    country codes before applying Bridge product availability gates."""
    findings: list[str] = []
    policies = [
        ("frontend", POLICY_FRONTEND.read_text()),
        ("backend", POLICY_BACKEND.read_text()),
    ]

    for label, src in policies:
        if "export function normalizeBridgeCountryCode" not in src:
            findings.append(f"{label}: missing normalizeBridgeCountryCode()")
        if not re.search(r"\bKEN\s*:\s*['\"]KE['\"]", src):
            findings.append(f"{label}: missing KEN -> KE ISO-3 normalization")
        if src.count("normalizeBridgeCountryCode(countryCode)") < 6:
            findings.append(
                f"{label}: Bridge country gates are not consistently using normalizeBridgeCountryCode(countryCode)"
            )

        no_us_match = re.search(
            r"const\s+BRIDGE_VA_NO_US_RAIL[^=]*=\s*new\s+Set\s*\(\s*\[([^\]]*)\]",
            src,
            flags=re.DOTALL,
        )
        if not no_us_match:
            findings.append(f"{label}: missing BRIDGE_VA_NO_US_RAIL")
            continue
        no_us_codes = set(re.findall(r"['\"]([A-Z]{2})['\"]", no_us_match.group(1)))
        if "KE" not in no_us_codes:
            findings.append(f"{label}: KE must remain in BRIDGE_VA_NO_US_RAIL")

    backend_src = POLICY_BACKEND.read_text()
    for required in (
        "export function bridgeCountryTier",
        "export function bridgeCountryBlockResponse",
        "export function bridgeVirtualAccountCurrenciesForCountry",
        "export function isBridgeCustodialWalletSupported",
    ):
        if required not in backend_src:
            findings.append(f"backend: missing required normalized policy entry point: {required}")

    frontend_src = POLICY_FRONTEND.read_text()
    for required in (
        "export function partnerCountryTier",
        "export function bridgeVirtualAccountCurrenciesForCountry",
        "export function isBridgeCustodialWalletSupported",
    ):
        if required not in frontend_src:
            findings.append(f"frontend: missing required normalized policy entry point: {required}")

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

    f4 = assert_gate_before_reuse()
    if f4:
        failures.append("(4) country gate is not the first check in:")
        failures.extend("    " + s for s in f4)

    f5 = assert_tiers_disjoint()
    if f5:
        failures.append("(5) tiers are not disjoint:")
        failures.extend("    " + s for s in f5)

    f6 = assert_iso3_normalization_and_va_gates()
    if f6:
        failures.append("(6) ISO-3 normalization / VA rail gate regression:")
        failures.extend("    " + s for s in f6)

    if failures:
        print("FAIL: bridge country policy parity audit")
        print()
        print("\n".join(failures))
        print()
        return 1

    # Report sizes for visibility.
    backend_src = POLICY_BACKEND.read_text()
    prohibited  = extract_set(backend_src, "BRIDGE_PROHIBITED_COUNTRIES")
    unavailable = extract_set(backend_src, "BRIDGE_UNAVAILABLE_COUNTRIES")
    controlled  = extract_set(backend_src, "BRIDGE_CONTROLLED_COUNTRIES")

    print("PASS: bridge country policy parity audit")
    print()
    print(f"  prohibited countries:        {len(prohibited)}   (hard-blocked, sanctions)")
    print(f"  unavailable countries:       {len(unavailable)}   (hard-blocked, commercial)")
    print(f"  controlled countries:        {len(controlled)}   (logged, not blocked)")
    print(f"  required-importer functions: {len(REQUIRED_IMPORTERS)}   (all import shared policy)")
    print(f"  inline country sets:         0   (in bridge-* edge functions, excluding policy file)")
    print(f"  gate-before-reuse:           ok  (every reuse path is preceded by isBridgeBlocked)")
    print(f"  tiers disjoint:              ok  (no country in more than one tier)")
    print(f"  ISO-3 normalization:         ok  (KEN normalizes to KE before VA/product gates)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

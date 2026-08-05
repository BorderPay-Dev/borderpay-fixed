#!/usr/bin/env python3
"""
Signup country eligibility audit (PR C).

Two-layer assertions:

  Structural (S1-S5)  — the SIGNUP code path consumes Bridge's live country
                        list, normalizes ISO-3 codes, and applies the shared
                        blocked-country policy without intersecting against
                        the narrower static COUNTRY_CONFIG.

  Semantic (E1-E5)    — the resulting set excludes Bridge-blocked
                        codes and retains controlled-tier codes.

Invariants:

  (S1) src/lib/countries.ts imports `isBridgeBlocked` from
       utils/compliance/partnerCountryPolicy.

  (S2) src/lib/countries.ts exports `getSignupCountriesFromBridge`.

  (S3) The body of `getSignupCountriesFromBridge` normalizes `code3` and
       filters through `isBridgeBlocked`.

  (S4) components/auth/SignUpFlow.tsx imports and calls
       `getSignupCountriesFromBridge`.

  (S5) components/auth/SignUpFlow.tsx does not call
       `getSignupEligibleCountries()` after receiving Bridge's live list.

  (E1) Every code in BRIDGE_PROHIBITED_COUNTRIES that is `status:
       'active'` in COUNTRY_CONFIG is excluded from signup-eligible.

  (E2) Every code in BRIDGE_UNAVAILABLE_COUNTRIES that is active is
       excluded.

  (E3) Explicit: 'CD' (DRC, Prohibited) is NOT signup-eligible.

  (E4) Explicit: 'DZ' (Algeria, Unavailable) is NOT signup-eligible.

  (E5) Sanity: controlled-tier sample codes NG and KE (if active)
       remain eligible — guards against an over-broad filter.

Non-runtime: parses TypeScript source via regex. No build, no Bridge
API call, no network. Read-only.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COUNTRIES_TS    = ROOT / "src" / "lib" / "countries.ts"
SIGNUP_TSX      = ROOT / "components" / "auth" / "SignUpFlow.tsx"
PARTNER_POLICY  = ROOT / "utils" / "compliance" / "partnerCountryPolicy.ts"


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def read(p: Path) -> str:
    if not p.is_file():
        fail(f"missing file: {p}")
    return p.read_text(encoding="utf-8")


def parse_set(text: str, name: str) -> set[str]:
    """Extract ISO codes from `export const <name>: ReadonlySet<string> = new Set([ ... ])`."""
    pattern = re.compile(
        rf"export\s+const\s+{re.escape(name)}\s*:\s*ReadonlySet<string>\s*=\s*new\s+Set\(\[(.*?)\]\)",
        re.DOTALL,
    )
    m = pattern.search(text)
    if not m:
        fail(f"could not locate {name} in partner policy")
    return set(re.findall(r'"([A-Z]{2})"', m.group(1)))


def parse_active_country_codes(text: str) -> set[str]:
    """Return every COUNTRY_CONFIG entry code whose status is 'active'."""
    cfg = re.search(
        r"export\s+const\s+COUNTRY_CONFIG\s*:\s*CountryConfig\[\]\s*=\s*\[(.*?)\];",
        text,
        re.DOTALL,
    )
    if not cfg:
        fail("could not locate COUNTRY_CONFIG in src/lib/countries.ts")
    body = cfg.group(1)
    code_positions = [m.start() for m in re.finditer(r"\bcode:\s*'[A-Z]{2}'", body)]
    code_positions.append(len(body))
    active: set[str] = set()
    for i in range(len(code_positions) - 1):
        chunk = body[code_positions[i] : code_positions[i + 1]]
        code_m   = re.search(r"\bcode:\s*'([A-Z]{2})'", chunk)
        status_m = re.search(r"\bstatus:\s*'(active|coming_soon|restricted)'", chunk)
        if code_m and status_m and status_m.group(1) == "active":
            active.add(code_m.group(1))
    return active


def extract_function_body(text: str, name: str) -> str | None:
    """Return the body source of an export const arrow function or function declaration.

    Tries to capture from `export const <name>` (arrow / fat-arrow expression)
    or `export function <name>` (declaration) up to the next top-level
    `export ` keyword. Conservative: returns the slice rather than parsing
    the AST, which is enough for `re.search` checks the caller wants.
    """
    # Arrow form: `export const foo = (...): T => ...;` (terminator: `;` at
    # column 0 OR the next top-level `export`).
    arrow = re.search(
        rf"export\s+const\s+{re.escape(name)}\s*(?::[^=]+)?=\s*(.*?)(?=^\s*export\s|\Z)",
        text,
        re.DOTALL | re.MULTILINE,
    )
    if arrow:
        return arrow.group(1)
    decl = re.search(
        rf"export\s+function\s+{re.escape(name)}\s*\(.*?\)\s*:[^{{]*?\{{(.*?)^\}}",
        text,
        re.DOTALL | re.MULTILINE,
    )
    if decl:
        return decl.group(1)
    return None


def main() -> int:
    countries_src = read(COUNTRIES_TS)
    signup_src    = read(SIGNUP_TSX)
    policy_src    = read(PARTNER_POLICY)

    # ── Structural invariants (anchor the audit to the actual code path) ──

    # (S1) src/lib/countries.ts imports isBridgeBlocked from the shared policy.
    s1 = re.search(
        r"^\s*import\s*\{[^}]*\bisBridgeBlocked\b[^}]*\}\s*from\s*['\"].*partnerCountryPolicy['\"]",
        countries_src,
        re.MULTILINE,
    )
    if not s1:
        fail("S1: src/lib/countries.ts must import isBridgeBlocked from "
             "utils/compliance/partnerCountryPolicy")

    # (S2) getSignupCountriesFromBridge is exported.
    s2 = re.search(r"\bexport\s+(const|function)\s+getSignupCountriesFromBridge\b", countries_src)
    if not s2:
        fail("S2: src/lib/countries.ts must export getSignupCountriesFromBridge")

    # (S3) Normalize Bridge ISO-3 and retain the shared compliance block.
    body = extract_function_body(countries_src, "getSignupCountriesFromBridge")
    if body is None:
        fail("S3: could not locate body of getSignupCountriesFromBridge")
    if "normalizeBridgeCountryCode(row?.code3)" not in body:
        fail("S3: getSignupCountriesFromBridge must normalize Bridge ISO-3 codes")
    if "isBridgeBlocked" not in body:
        fail("S3: getSignupCountriesFromBridge must retain the shared blocked-country policy")

    # (S4) SignUpFlow.tsx imports + calls the Bridge response normalizer.
    if not re.search(
        r"import\s*\{[^}]*\bgetSignupCountriesFromBridge\b[^}]*\}\s*from\s*['\"].*?countries['\"]",
        signup_src,
    ):
        fail("S4: SignUpFlow.tsx must import getSignupCountriesFromBridge from countries")
    if not re.search(r"\bgetSignupCountriesFromBridge\s*\(", signup_src):
        fail("S4: SignUpFlow.tsx must call getSignupCountriesFromBridge() at least once")

    # (S5) Do not re-intersect the live Bridge response with COUNTRY_CONFIG.
    if re.search(r"\bgetSignupEligibleCountries\s*\(\s*\)", signup_src):
        fail("S5: SignUpFlow.tsx must not intersect Bridge's live list with "
             "getSignupEligibleCountries()")

    # ── Semantic invariants (the resulting set behaves as expected) ──

    prohibited  = parse_set(policy_src, "BRIDGE_PROHIBITED_COUNTRIES")
    unavailable = parse_set(policy_src, "BRIDGE_UNAVAILABLE_COUNTRIES")
    controlled  = parse_set(policy_src, "BRIDGE_CONTROLLED_COUNTRIES")
    blocked     = prohibited | unavailable
    active      = parse_active_country_codes(countries_src)
    eligible    = active - blocked

    prohibited_in_active = prohibited & active
    if prohibited_in_active & eligible:
        fail(f"E1: prohibited codes leaked into signup-eligible: "
             f"{sorted(prohibited_in_active & eligible)}")

    unavailable_in_active = unavailable & active
    if unavailable_in_active & eligible:
        fail(f"E2: unavailable codes leaked into signup-eligible: "
             f"{sorted(unavailable_in_active & eligible)}")

    if "CD" in eligible:
        fail("E3: CD (DRC, Prohibited) must not be signup-eligible")

    if "DZ" in eligible:
        fail("E4: DZ (Algeria, Unavailable) must not be signup-eligible")

    for sample in ("NG", "KE"):
        if sample in active and sample not in eligible:
            fail(f"E5: {sample} is active and Bridge-controlled (not blocked) — "
                 f"must remain signup-eligible. Filter is over-broad.")

    print(f"OK: structural S1-S5 hold; semantic {len(active)} active → "
          f"{len(eligible)} signup-eligible "
          f"(removed {len(prohibited_in_active)} prohibited, "
          f"{len(unavailable_in_active)} unavailable; "
          f"retained {len(controlled & active)} controlled).")
    print(f"     prohibited∩active removed: {sorted(prohibited_in_active) or '(none)'}")
    print(f"     unavailable∩active removed: {sorted(unavailable_in_active) or '(none)'}")
    print(f"     controlled∩active retained: {sorted(controlled & active) or '(none)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

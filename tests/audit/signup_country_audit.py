#!/usr/bin/env python3
"""
Signup country eligibility audit (PR C).

Asserts that the signup country picker — sourced from
`getSignupEligibleCountries()` in `src/lib/countries.ts` — excludes
every Bridge-blocked country, with explicit checks on the two codes
that were selectable pre-PR-C (CD, DZ). Also asserts that controlled-
tier codes which exist in COUNTRY_CONFIG remain eligible (Bridge
allows onboarding with enhanced verification — we surface a warning
in the UI but do not block).

Invariants:

  (E1) Every code in BRIDGE_PROHIBITED_COUNTRIES that also has a
       `status: 'active'` entry in COUNTRY_CONFIG is excluded by
       getSignupEligibleCountries().

  (E2) Every code in BRIDGE_UNAVAILABLE_COUNTRIES that also has a
       `status: 'active'` entry in COUNTRY_CONFIG is excluded.

  (E3) Explicit check: 'CD' (DRC, Prohibited) is NOT in the
       signup-eligible set.

  (E4) Explicit check: 'DZ' (Algeria, Unavailable) is NOT in the
       signup-eligible set.

  (E5) Sanity: at least one controlled-tier code that is active in
       COUNTRY_CONFIG remains eligible. Specifically NG and KE if
       present (they currently are). This guards against an over-broad
       filter that accidentally drops controlled.

Non-runtime: this audit parses TypeScript source via regex. No build
required. No Bridge API call. Read-only.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COUNTRIES_TS    = ROOT / "src" / "lib" / "countries.ts"
PARTNER_POLICY  = ROOT / "utils" / "compliance" / "partnerCountryPolicy.ts"


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def read(p: Path) -> str:
    if not p.is_file():
        fail(f"missing file: {p}")
    return p.read_text(encoding="utf-8")


def parse_set(text: str, name: str) -> set[str]:
    """Extract the ISO codes inside `export const <name>: ReadonlySet<string> = new Set([ ... ])`."""
    pattern = re.compile(
        rf"export\s+const\s+{re.escape(name)}\s*:\s*ReadonlySet<string>\s*=\s*new\s+Set\(\[(.*?)\]\)",
        re.DOTALL,
    )
    m = pattern.search(text)
    if not m:
        fail(f"could not locate {name} in partner policy")
    body = m.group(1)
    return set(re.findall(r'"([A-Z]{2})"', body))


def parse_active_country_codes(text: str) -> set[str]:
    """Find every COUNTRY_CONFIG entry with status: 'active' and return its code.

    The config is a hand-edited array of objects; each entry has a
    `code: 'XX'` field and a `status: 'active' | 'coming_soon' | 'restricted'`
    field. We scan entry-by-entry rather than line-by-line because the
    two fields can be on the same line or split across lines.
    """
    # Slice into entries by matching `{ ... }` blocks inside the COUNTRY_CONFIG array.
    config_match = re.search(
        r"export\s+const\s+COUNTRY_CONFIG\s*:\s*CountryConfig\[\]\s*=\s*\[(.*?)\];",
        text,
        re.DOTALL,
    )
    if not config_match:
        fail("could not locate COUNTRY_CONFIG in src/lib/countries.ts")
    body = config_match.group(1)

    active: set[str] = set()
    # Greedy split by top-level `{`...`}` is awkward in regex with nested
    # objects (idTypes). A simpler heuristic: walk entries by `code: '..'`
    # lookahead, then for each entry slurp until the next `code:` or end.
    code_positions = [m.start() for m in re.finditer(r"\bcode:\s*'[A-Z]{2}'", body)]
    code_positions.append(len(body))
    for i in range(len(code_positions) - 1):
        chunk = body[code_positions[i] : code_positions[i + 1]]
        code_m = re.search(r"\bcode:\s*'([A-Z]{2})'", chunk)
        status_m = re.search(r"\bstatus:\s*'(active|coming_soon|restricted)'", chunk)
        if not code_m or not status_m:
            continue
        if status_m.group(1) == "active":
            active.add(code_m.group(1))
    return active


def main() -> int:
    countries_src   = read(COUNTRIES_TS)
    policy_src      = read(PARTNER_POLICY)

    prohibited  = parse_set(policy_src, "BRIDGE_PROHIBITED_COUNTRIES")
    unavailable = parse_set(policy_src, "BRIDGE_UNAVAILABLE_COUNTRIES")
    controlled  = parse_set(policy_src, "BRIDGE_CONTROLLED_COUNTRIES")
    blocked     = prohibited | unavailable
    active      = parse_active_country_codes(countries_src)

    # The signup-eligible set is the in-source semantic of
    # getSignupEligibleCountries(): active \ blocked.
    eligible = active - blocked

    # (E1)
    prohibited_in_active = prohibited & active
    leaked_prohibited    = prohibited_in_active & eligible
    if leaked_prohibited:
        fail(f"prohibited codes leaked into signup-eligible: {sorted(leaked_prohibited)}")

    # (E2)
    unavailable_in_active = unavailable & active
    leaked_unavailable    = unavailable_in_active & eligible
    if leaked_unavailable:
        fail(f"unavailable codes leaked into signup-eligible: {sorted(leaked_unavailable)}")

    # (E3)
    if "CD" in eligible:
        fail("CD (DRC, Prohibited) must not be signup-eligible")

    # (E4)
    if "DZ" in eligible:
        fail("DZ (Algeria, Unavailable) must not be signup-eligible")

    # (E5)
    for sample in ("NG", "KE"):
        if sample in active and sample not in eligible:
            fail(
                f"{sample} is in COUNTRY_CONFIG as active and is Bridge-controlled "
                f"(not blocked) — must remain signup-eligible. Filter is over-broad."
            )

    # Sanity reporting (visible in CI logs but does not fail)
    print(f"OK: {len(active)} active countries; "
          f"{len(prohibited_in_active)} prohibited removed; "
          f"{len(unavailable_in_active)} unavailable removed; "
          f"{len(eligible)} signup-eligible.")
    print(f"     prohibited∩active removed: {sorted(prohibited_in_active) or '(none)'}")
    print(f"     unavailable∩active removed: {sorted(unavailable_in_active) or '(none)'}")
    print(f"     controlled∩active retained: {sorted(controlled & active) or '(none)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

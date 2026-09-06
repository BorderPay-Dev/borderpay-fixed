#!/usr/bin/env python3
"""Fail closed if public signup or its country feed can expose Ukraine."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
signup = (ROOT / "supabase/functions/auth-signup/index.ts").read_text()
countries = (ROOT / "supabase/functions/bridge-supported-countries/index.ts").read_text()
policy = (ROOT / "supabase/functions/_shared/providers/bridge-country-policy.ts").read_text()

assert 'normalizedCountryCode = String(country_code || "")' in signup
assert "!/^[A-Z]{2}$/.test(normalizedCountryCode)" in signup
assert 'normalizedCountryCode === "UA"' in signup
assert 'isBridgeBlocked(normalizedCountryCode)' in signup
assert 'policyCode === "UA"' in countries
assert 'isBridgeBlocked(policyCode)' in countries
assert 'UKR: "UA"' in policy

print("signup_country_enforcement_audit: PASS")

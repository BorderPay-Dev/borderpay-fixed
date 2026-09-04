#!/usr/bin/env python3
"""P0 guard for the public web/native signup contract."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
signup = (ROOT / "components/auth/SignUpFlow.tsx").read_text()
countries = (ROOT / "src/lib/countries.ts").read_text()
auth_signup = (ROOT / "supabase/functions/auth-signup/index.ts").read_text()
country_endpoint = (ROOT / "supabase/functions/bridge-supported-countries/index.ts").read_text()

assert "const steps: SignUpStep[] = ['personal', 'confirm-email'];" in signup
assert "const totalSteps = steps.length;" in signup
assert "Create Business Account" in signup
assert "setCurrentStep('identity');" not in signup
assert "?? getCountryByCode(detectedCode)" not in signup

restricted_gate = "isBridgeBlocked(code) || code === 'UA'"
assert restricted_gate in countries
assert "!^[A-Z]{2}$" not in auth_signup  # guard against accidental malformed literal
assert "!/^[A-Z]{2}$/.test(normalizedCountryCode)" in auth_signup
assert 'normalizedCountryCode === "UA"' in auth_signup
assert 'isBridgeBlocked(policyCode) || policyCode === "UA"' in country_endpoint

print("signup_compliance_release_audit: PASS")

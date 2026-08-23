#!/usr/bin/env python3
"""Authenticated capability reads must not weaken mutation controls."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "supabase/functions/bridge-external-account/index.ts").read_text()
FORM = (ROOT / "components/payouts/AddExternalAccountScreen.tsx").read_text()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


auth_at = SOURCE.find("await supa.auth.getUser(token)")
access_at = SOURCE.find("await getFinancialAccessBlock(supa, user.id)")
body_at = SOURCE.find("const action = String(body.action")
capability_at = SOURCE.find('if (action === "capabilities")')
identity_at = SOURCE.find("await loadAndAssertBridgeIdentityInvariant(supa, user.id)")
country_at = SOURCE.find("if (isBridgeBlocked(profile?.country))")
customer_at = SOURCE.find("if (!profile.bridge_customer_id)")
verification_at = SOURCE.find('if (profile.verification_status !== "approved")')
create_sca_at = SOURCE.rfind("await consumeScaAuthorization({")
bridge_create_at = SOURCE.rfind("const r = await bridgeFetch({")

require(0 <= auth_at < access_at < body_at < capability_at,
        "capability discovery must remain authenticated and access guarded")
require(capability_at < identity_at,
        "capability discovery must precede customer provisioning checks")
require(SOURCE.count('if (action === "capabilities")') == 1,
        "capability response must have one canonical branch")
require('supported_account_types: ["us", "iban", "gb"]' in SOURCE,
        "capability response must retain approved fiat account types")
require(capability_at < identity_at < country_at < customer_at < verification_at,
        "mutations must retain identity, country and verification guards")
require(verification_at < create_sca_at < bridge_create_at,
        "account creation must retain SCA before the provider mutation")
require('US: "USA"' in SOURCE and "bridgeCountryAlpha3(a.address?.country)" in SOURCE,
        "US addresses must be normalized to Bridge's ISO-3 contract")
require("!a.address?.state" in SOURCE and "state:          a.address.state" in SOURCE,
        "US state must be required and forwarded")
require("bridgeCountryAlpha3(a.iban_country)" in SOURCE and "country: ibanCountry" in SOURCE,
        "IBAN country must be normalized to Bridge's ISO-3 contract")
require("useState('USA')" in FORM and 'placeholder="Country (ISO-3)"' in FORM,
        "US form must default to Bridge's ISO-3 country code")
require("!stateRegion.trim()" in FORM and 'placeholder="State code (required)"' in FORM,
        "US form must require the provider-required state code")
require('placeholder="DE or DEU"' in FORM and "maxLength={3}" in FORM,
        "IBAN form must accept alpha-2 input for normalization or alpha-3 directly")

print("external account capability gate audit: PASS")

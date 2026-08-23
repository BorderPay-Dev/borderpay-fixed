#!/usr/bin/env python3
"""Authenticated capability reads must not weaken mutation controls."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "supabase/functions/bridge-external-account/index.ts").read_text()


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

print("external account capability gate audit: PASS")

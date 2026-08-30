#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

catalog = (ROOT / "supabase/functions/_shared/providers/yellowcard-commercial-policy.ts").read_text()
capabilities = (ROOT / "supabase/functions/yellowcard-capabilities/index.ts").read_text()
transaction = (ROOT / "supabase/functions/yellowcard-receive/index.ts").read_text()
cache = (ROOT / "utils/africanRailsPolicyCache.ts").read_text()
send = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
receive = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()
geo = (ROOT / "api/geo.ts").read_text()

assert 'source_document_date: SOURCE_DOCUMENT_DATE' in catalog
assert 'country: "CD", currency: "CDF", channel: "mobile_money"' in catalog
assert 'direction: "receive", country: "CD"' not in catalog
assert 'listYellowCardCommercialRails(' in capabilities
assert 'direction === "receive" ? "account_country_only" : "global_sender"' in capabilities
assert 'direction === "receive" ? profileCountry : null' in capabilities
assert 'const publicRows = commercialRows.filter' in capabilities
assert 'source: "yellow_card_commercial_schedule_intersect_live_channels"' in capabilities
assert 'discovery_status: "live_coverage_verified"' in capabilities
assert 'path: "/channels"' in capabilities
assert 'isYellowCardSandboxCountryEnabled' not in capabilities
assert 'authenticateVerifiedAfricanRailsUser(supa, req)' in capabilities
assert 'receive_country_must_match_account_country' in transaction
assert 'allow_all_receive_countries' not in transaction
assert 'yellow_card_commercial_corridor_unavailable' in transaction
assert 'isYellowCardSandboxCountryEnabled' not in transaction
assert 'return `${direction}:${userId}:${country}`' in cache
assert "if (provider !== 'yellow_card') return" in cache
assert "if (!africanRailsDiscoveryAllowed) {" in send
assert "disabled={!africanRailsDiscoveryAllowed}" not in send
assert '<MotionConfig reducedMotion="always">' in send
assert 'autoFocus' not in send
assert '[overflow-anchor:none]' in send
assert "yellowCardReceive" in receive
assert "payouts.createCollection" not in receive
assert '[overflow-anchor:none]' in receive
assert "{africanRailsDiscoveryAllowed ? <button" in receive
assert 'disabled={africanPolicyLoading || regionalAfricanCountries.length === 0}' in receive
assert 'className={`w-full min-h-[72px]' in receive
assert "Complete verification to use this feature" in receive
assert "africanPolicyLoading || africanCountries.length > 0" not in receive
assert "Checking rails for your account country" not in receive
assert "const regionalAfricanCountries = africanCountries" in receive
assert "x-vercel-ip-country" in geo
assert "country: null" not in geo

print("yellowcard commercial scope audit passed")

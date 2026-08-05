#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

catalog = (ROOT / "supabase/functions/_shared/providers/yellowcard-commercial-policy.ts").read_text()
capabilities = (ROOT / "supabase/functions/yellowcard-capabilities/index.ts").read_text()
transaction = (ROOT / "supabase/functions/yellowcard-sandbox-transaction/index.ts").read_text()
cache = (ROOT / "utils/africanRailsPolicyCache.ts").read_text()
send = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
receive = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()
geo = (ROOT / "api/geo.ts").read_text()

assert 'source_document_date: SOURCE_DOCUMENT_DATE' in catalog
assert 'country: "CD", currency: "CDF", channel: "mobile_money"' in catalog
assert 'direction: "receive", country: "CD"' not in catalog
assert 'listYellowCardCommercialRails(' in capabilities
assert '"integration_tester_all_receive_countries"' in capabilities
assert 'direction === "receive" ? "account_country_only" : "global_sender"' in capabilities
assert 'direction === "receive" ? profileCountry : null' in capabilities
assert 'isAfricanRailsTesterEmail(user.email)' in capabilities
assert 'receive_country_must_match_account_country' in transaction
assert 'allow_all_receive_countries: isAfricanRailsTesterEmail(access.user.email)' in transaction
assert 'yellow_card_commercial_corridor_unavailable' in transaction
assert 'return `${direction}:${userId}:${country}`' in cache
assert "if (provider !== 'yellow_card') return" in cache
assert "if (!africanRailsTester) {" in send
assert "disabled={!africanRailsTester}" not in send
assert "yellowCardSandboxTransaction" in receive
assert "payouts.createCollection" not in receive
assert "flutterwave" not in receive.lower()
assert "{regionalAfricanCountries.length > 0 && <button" in receive
assert "africanPolicyLoading || africanCountries.length > 0" not in receive
assert "Checking rails for your account country" not in receive
assert "item.countryCode === ipCountry" in receive
assert "africanRailsTester\n      ? africanCountries" in receive
assert "x-vercel-ip-country" in geo
assert "country: null" not in geo

print("yellowcard commercial scope audit passed")

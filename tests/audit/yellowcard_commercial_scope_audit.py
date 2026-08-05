#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

catalog = (ROOT / "supabase/functions/_shared/providers/yellowcard-commercial-policy.ts").read_text()
capabilities = (ROOT / "supabase/functions/yellowcard-capabilities/index.ts").read_text()
transaction = (ROOT / "supabase/functions/yellowcard-sandbox-transaction/index.ts").read_text()
cache = (ROOT / "utils/africanRailsPolicyCache.ts").read_text()
send = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
receive = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()

assert 'source_document_date: SOURCE_DOCUMENT_DATE' in catalog
assert 'country: "CD", currency: "CDF", channel: "mobile_money"' in catalog
assert 'direction: "receive", country: "CD"' not in catalog
assert 'listYellowCardCommercialRails(' in capabilities
assert 'eligibility: direction === "receive" ? "account_country_only" : "global_sender"' in capabilities
assert 'direction === "receive" ? profileCountry : null' in capabilities
assert 'isAfricanRailsTesterEmail(user.email)' in capabilities
assert 'receive_country_must_match_account_country' in transaction
assert 'yellow_card_commercial_corridor_unavailable' in transaction
assert 'return `${direction}:${userId}:${country}`' in cache
assert "if (provider !== 'yellow_card') return" in cache
assert "if (!africanRailsTester) {" in send
assert "disabled={!africanRailsTester}" not in send
assert "yellowCardSandboxTransaction" in receive
assert "payouts.createCollection" not in receive
assert "flutterwave" not in receive.lower()

print("yellowcard commercial scope audit passed")

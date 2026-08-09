#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
cache = (ROOT / "utils/yellowCardCapabilityCache.ts").read_text()
send = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
receive = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()
capabilities = (ROOT / "supabase/functions/yellowcard-capabilities/index.ts").read_text()

for fragment in (
    "const inFlight = new Map",
    "action === 'routing' ? 5 * 60_000 : 30_000",
    "sessionStorage.setItem",
    "if (hasUsableCapability(action, result))",
    "borderpay_yellowcard_capability_v2:",
    "hasUsableCapability",
):
    assert fragment in cache, f"missing client capability cache contract: {fragment}"

assert "yellowCardSandboxTransaction" not in cache, "transaction execution must never be cached"
assert "Boolean(routing?.available) && networks.length > 0" in cache
assert "loadYellowCardCapability('rates'" in send
assert "loadYellowCardCapability('routing'" in send
assert "loadYellowCardCapability('routing'" in receive

for ui in (send, receive):
    assert "YELLOW_CARD_PAYMENT_REASONS" in ui
    assert "Choose a transaction reason" in ui
    assert "reason: 'other'" not in ui

assert "reason: reason.trim()" in send
assert "reason: collectionReason.trim()" in receive
assert "if (!collectionReason.trim()) return false" in receive
assert "reason.trim().length > 0" in send
assert "institutionsLoadInFlightRef" not in send
assert "seededFromCache && Number.isFinite(last)" in send
assert "No active network is available for the selected route." in send

assert "await Promise.all([" in capabilities
assert 'cachedDiscovery(`channels:${country}`' in capabilities
assert 'cachedDiscovery(`networks:${country}`' in capabilities
assert 'action === "rates" ? 30_000 : 5 * 60_000' in capabilities

print("yellowcard capability cache and required reason audit passed")

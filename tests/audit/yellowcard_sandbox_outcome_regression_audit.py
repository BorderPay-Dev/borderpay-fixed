#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def source(path: str) -> str:
    file = ROOT / path
    if not file.is_file():
        raise SystemExit(f"missing production rail source: {path}")
    return file.read_text()


if (ROOT / "supabase/functions/yellowcard-sandbox-transaction/index.ts").exists():
    raise SystemExit("legacy Yellow Card sandbox transaction endpoint must remain removed")

send = source("components/send/SendMoneyFlow.tsx")
receive = source("components/receive/ReceiveMoneyScreen.tsx")
capabilities = source("supabase/functions/yellowcard-capabilities/index.ts")
receive_endpoint = source("supabase/functions/yellowcard-receive/index.ts")
payout_endpoint = source("supabase/functions/yellowcard-jit-payout/index.ts")
access = source("supabase/functions/_shared/african-rails-access.ts")

combined = "\n".join((send, receive, capabilities, receive_endpoint, payout_endpoint, access))
for forbidden in (
    "adhiamboadhiambo22@gmail.com",
    "AFRICAN_RAILS_TEST_EMAILS",
    "isAfricanRailsTesterEmail",
    "yellow-card-sandbox-usdc",
    "yellow-card-sandbox-usdt",
):
    if forbidden in combined:
        raise SystemExit(f"tester-only Yellow Card behavior remains: {forbidden}")

required = {
    "Send UI": (send, "backendAPI.payouts.yellowCardJitPayout"),
    "Receive UI": (receive, "backendAPI.payouts.yellowCardReceive"),
    "Capabilities": (capabilities, "authenticateVerifiedAfricanRailsUser"),
    "Receive endpoint": (receive_endpoint, "authenticateVerifiedAfricanRailsUser"),
    "Payout endpoint": (payout_endpoint, "authenticateVerifiedAfricanRailsUser"),
    "Verification gate": (access, 'verificationStatus !== "approved"'),
}
for label, (text, fragment) in required.items():
    if fragment not in text:
        raise SystemExit(f"{label} is missing production invariant: {fragment}")

print("yellowcard production access regression audit passed")

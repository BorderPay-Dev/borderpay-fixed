from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SERVER_GATE = ROOT / "supabase/functions/_shared/african-rails-access.ts"
FRONTEND_GATE = ROOT / "utils/africanRailsAccess.ts"
SEND_UI = ROOT / "components/send/SendMoneyFlow.tsx"
RECEIVE_UI = ROOT / "components/receive/ReceiveMoneyScreen.tsx"
ENDPOINTS = [
    "yellowcard-capabilities",
    "yellowcard-transaction",
]

TESTER = "adhiamboadhiambo22@gmail.com"
DEMO_TESTERS = [
    "appreview.individual@borderpayafrica.com",
    "appreview.business@borderpayafrica.com",
]

failures = []
server = SERVER_GATE.read_text()
frontend = FRONTEND_GATE.read_text()
send_ui = SEND_UI.read_text()
receive_ui = RECEIVE_UI.read_text()

if "const africanPayoutEnabled = false" not in send_ui or "Send to Africa coming soon" not in send_ui:
    failures.append("production payout UI is not fail-closed")
if "isVerified ? <button" not in receive_ui or "Complete identity verification" not in receive_ui:
    failures.append("production Receive is not limited to verified customers")

for endpoint in ENDPOINTS:
    path = ROOT / f"supabase/functions/{endpoint}/index.ts"
    source = path.read_text()
    gate_tokens = ["auth.getUser", "await authenticateAfricanRailsUser"]
    gate_pos = min((source.find(token) for token in gate_tokens if source.find(token) >= 0), default=-1)
    capability_pos = source.find("getYellowCardConfig()")
    if gate_pos < 0 or capability_pos < 0 or gate_pos > capability_pos:
        failures.append(f"{endpoint} checks provider runtime before tester access")

transaction = (ROOT / "supabase/functions/yellowcard-transaction/index.ts").read_text()
if "receive_country_must_match_account_country" not in transaction or "allow_all_receive_countries" in transaction:
    failures.append("production Receive country restriction is missing or client-bypassable")
if 'code: "yellow_card_payout_funding_not_configured"' not in transaction:
    failures.append("production payout execution is not fail-closed")

if failures:
    print("african_rails_closed_beta_gate_audit: FAIL")
    for failure in failures:
        print(f" - {failure}")
    raise SystemExit(1)

print("african_rails_production_access_gate_audit: PASS")

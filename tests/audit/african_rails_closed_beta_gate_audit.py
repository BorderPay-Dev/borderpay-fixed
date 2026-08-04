from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SERVER_GATE = ROOT / "supabase/functions/_shared/african-rails-access.ts"
FRONTEND_GATE = ROOT / "utils/africanRailsAccess.ts"
ENDPOINTS = [
    "flutterwave-capabilities",
    "flutterwave-account-resolve",
    "flutterwave-transfer-rates",
    "flutterwave-transfer-create",
    "flutterwave-transfer-status",
    "flutterwave-transfers-list",
    "flutterwave-collection-create",
    "flutterwave-collection-status",
    "flutterwave-collections-list",
    "get-momo-providers",
]

TESTER = "adhiamboadhiambo22@gmail.com"
FORBIDDEN = [
    "appreview.individual@borderpayafrica.com",
    "appreview.business@borderpayafrica.com",
]

failures = []
server = SERVER_GATE.read_text()
frontend = FRONTEND_GATE.read_text()
send_ui = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
receive_ui = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()

for label, source in [("server", server), ("frontend", frontend)]:
    if TESTER not in source:
        failures.append(f"{label} gate is missing the controlled tester")
    for email in FORBIDDEN:
        if email in source:
            failures.append(f"{label} gate still includes app-review account {email}")

if "african_rails_closed_beta" not in server:
    failures.append("server gate is missing the fail-closed response code")

if "{africanRailsTester && <button" not in send_ui:
    failures.append("send UI must hide African rails completely outside the tester gate")
if "{africanRailsTester && <button" not in receive_ui:
    failures.append("receive UI must hide African rails completely outside the tester gate")

for endpoint in ENDPOINTS:
    path = ROOT / f"supabase/functions/{endpoint}/index.ts"
    source = path.read_text()
    if "authenticateAfricanRailsTester" not in source:
        failures.append(f"{endpoint} does not enforce the shared server gate")
    gate_pos = source.find("await authenticateAfricanRailsTester")
    capability_pos = source.find("getFlutterwaveCapabilities()")
    if gate_pos < 0 or capability_pos < 0 or gate_pos > capability_pos:
        failures.append(f"{endpoint} checks provider runtime before tester access")

if failures:
    print("african_rails_closed_beta_gate_audit: FAIL")
    for failure in failures:
        print(f" - {failure}")
    raise SystemExit(1)

print("african_rails_closed_beta_gate_audit: PASS")

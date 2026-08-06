from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SERVER_GATE = ROOT / "supabase/functions/_shared/african-rails-access.ts"
FRONTEND_GATE = ROOT / "utils/africanRailsAccess.ts"
ENDPOINTS = [
    "yellowcard-capabilities",
    "yellowcard-sandbox-transaction",
]

TESTER = "adhiamboadhiambo22@gmail.com"
DEMO_TESTERS = [
    "appreview.individual@borderpayafrica.com",
    "appreview.business@borderpayafrica.com",
]

failures = []
server = SERVER_GATE.read_text()
frontend = FRONTEND_GATE.read_text()

for label, source in [("server", server), ("frontend", frontend)]:
    if TESTER not in source:
        failures.append(f"{label} gate is missing the controlled tester")
    for email in DEMO_TESTERS:
        if email not in source:
            failures.append(f"{label} gate is missing app-review tester {email}")

if "african_rails_closed_beta" not in server:
    failures.append("server gate is missing the fail-closed response code")

for endpoint in ENDPOINTS:
    path = ROOT / f"supabase/functions/{endpoint}/index.ts"
    source = path.read_text()
    gate_tokens = ["await authenticateAfricanRailsTester", "isAfricanRailsTesterEmail(user.email)"]
    gate_pos = min((source.find(token) for token in gate_tokens if source.find(token) >= 0), default=-1)
    capability_pos = source.find("getYellowCardConfig()")
    if gate_pos < 0 or capability_pos < 0 or gate_pos > capability_pos:
        failures.append(f"{endpoint} checks provider runtime before tester access")

if failures:
    print("african_rails_closed_beta_gate_audit: FAIL")
    for failure in failures:
        print(f" - {failure}")
    raise SystemExit(1)

print("african_rails_closed_beta_gate_audit: PASS")

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SERVER_GATE = ROOT / "supabase/functions/_shared/african-rails-access.ts"
FRONTEND_GATE = ROOT / "utils/africanRailsAccess.ts"
ENDPOINTS = [
    "yellowcard-capabilities",
    "yellowcard-sandbox-transaction",
]

TESTER = "adhiamboadhiambo22@gmail.com"
FORBIDDEN = [
    "appreview.individual@borderpayafrica.com",
    "appreview.business@borderpayafrica.com",
]

failures = []
server = SERVER_GATE.read_text()
frontend = FRONTEND_GATE.read_text()

for label, source in [("server", server), ("frontend", frontend)]:
    if TESTER not in source:
        failures.append(f"{label} gate is missing the controlled tester")
    for email in FORBIDDEN:
        if email in source:
            failures.append(f"{label} gate still includes app-review account {email}")

if "african_rails_closed_beta" not in server:
    failures.append("server gate is missing the fail-closed response code")

for endpoint in ENDPOINTS:
    path = ROOT / f"supabase/functions/{endpoint}/index.ts"
    source = path.read_text()
    if "authenticateAfricanRailsTester" not in source:
        failures.append(f"{endpoint} does not enforce the shared server gate")
    gate_pos = source.find("await authenticateAfricanRailsTester")
    if gate_pos < 0:
        failures.append(f"{endpoint} is missing the tester gate call")

if failures:
    print("african_rails_closed_beta_gate_audit: FAIL")
    for failure in failures:
        print(f" - {failure}")
    raise SystemExit(1)

print("african_rails_closed_beta_gate_audit: PASS")

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SERVER_GATE = ROOT / "supabase/functions/_shared/african-rails-access.ts"
FRONTEND_GATE = ROOT / "utils/africanRailsAccess.ts"
SEND_UI = ROOT / "components/send/SendMoneyFlow.tsx"
RECEIVE_UI = ROOT / "components/receive/ReceiveMoneyScreen.tsx"
ENDPOINTS = ["yellowcard-capabilities", "yellowcard-receive"]

failures = []
server = SERVER_GATE.read_text()
frontend = FRONTEND_GATE.read_text()
send_ui = SEND_UI.read_text()
receive_ui = RECEIVE_UI.read_text()

for forbidden in ("AFRICAN_RAILS_TEST_EMAILS", "isAfricanRailsTesterEmail", "african_rails_closed_beta"):
    if forbidden in server or forbidden in frontend:
        failures.append(f"legacy tester-only gate remains: {forbidden}")

for required in ("loadAndAssertBridgeIdentityInvariant", "verificationStatus !== \"approved\"", "bridge_customer_id"):
    if required not in server:
        failures.append(f"server verified-account gate is missing {required}")
for required in ("bridge_customer_id", "bridge_kyc_status", "bridge_kyb_status", "status === 'approved'"):
    if required not in frontend:
        failures.append(f"frontend verified-account hint is missing {required}")

for required in ("canDiscoverAfricanRails", "Boolean(String(input?.id || '').trim())"):
    if required not in frontend:
        failures.append(f"frontend authoritative policy discovery gate is missing {required}")

for ui_name, ui in (("send", send_ui), ("receive", receive_ui)):
    if "africanRailsDiscoveryAllowed" not in ui:
        failures.append(f"{ui_name} UI still blocks policy discovery on cached verification fields")

if "African receive rails coming soon" in receive_ui:
    failures.append("receive UI still presents production rails as a closed beta")

for endpoint in ENDPOINTS:
    path = ROOT / f"supabase/functions/{endpoint}/index.ts"
    source = path.read_text()
    gate_tokens = ["await authenticateVerifiedAfricanRailsUser"]
    gate_pos = min((source.find(token) for token in gate_tokens if source.find(token) >= 0), default=-1)
    capability_pos = source.find("getYellowCardConfig()")
    if gate_pos < 0 or capability_pos < 0 or gate_pos > capability_pos:
        failures.append(f"{endpoint} checks provider runtime before tester access")

capabilities = (ROOT / "supabase/functions/yellowcard-capabilities/index.ts").read_text()
policy_pos = capabilities.find('if (action === "corridor_policy")')
deny_pos = capabilities.find('const access = await authenticateVerifiedAfricanRailsUser')
if deny_pos < 0 or policy_pos < 0 or deny_pos > policy_pos:
    failures.append("yellowcard-capabilities exposes corridor policy before verified-account access")

if failures:
    print("african_rails_closed_beta_gate_audit: FAIL")
    for failure in failures:
        print(f" - {failure}")
    raise SystemExit(1)

print("african_rails_verified_account_gate_audit: PASS")

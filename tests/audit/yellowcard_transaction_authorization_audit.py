from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEND = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
RECEIVE = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()
FUNCTION = (ROOT / "supabase/functions/yellowcard-sandbox-transaction/index.ts").read_text()
VERIFY_PIN = (ROOT / "supabase/functions/verify-pin/index.ts").read_text()
WEBAUTHN = (ROOT / "supabase/functions/webauthn-auth-verify/index.ts").read_text()

failures = []
for label, source in [("send", SEND), ("receive", RECEIVE)]:
    if "transaction_authorization" not in source:
        failures.append(f"{label} does not send transaction authorization")
    if "authorizeTransaction" not in source:
        failures.append(f"{label} does not authorize with transaction PIN")
    if "BiometricManager.verify" not in source:
        failures.append(f"{label} does not offer biometric authorization")

if "verifyTransactionAuthorization" not in FUNCTION:
    failures.append("Yellow Card function does not verify signed authorization")
if "transaction_authorization_required" not in FUNCTION:
    failures.append("Yellow Card function lacks fail-closed authorization response")
if "issueTransactionAuthorization" not in VERIFY_PIN:
    failures.append("PIN verification does not issue authorization proof")
if "issueTransactionAuthorization" not in WEBAUTHN:
    failures.append("biometric verification does not issue authorization proof")
if "bridge_settlement_wallet_required" in FUNCTION:
    failures.append("sandbox transaction still requires a Bridge settlement wallet")
if 'settlement_source: "yellow_card_sandbox"' not in FUNCTION:
    failures.append("sandbox settlement source is not explicit")
if '.from("bridge_wallets")' in FUNCTION:
    failures.append("sandbox transaction reads live Bridge wallets")
if "africanRailsTester ? [" not in SEND:
    failures.append("controlled tester does not receive isolated sandbox test funds")

if failures:
    print("yellowcard_transaction_authorization_audit: FAIL")
    for failure in failures:
        print(f" - {failure}")
    raise SystemExit(1)

print("yellowcard_transaction_authorization_audit: PASS")

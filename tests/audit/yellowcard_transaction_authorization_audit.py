from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEND = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
RECEIVE = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()
FUNCTION = (ROOT / "supabase/functions/yellowcard-sandbox-transaction/index.ts").read_text()
VERIFY_PIN = (ROOT / "supabase/functions/verify-pin/index.ts").read_text()
WEBAUTHN = (ROOT / "supabase/functions/webauthn-auth-verify/index.ts").read_text()

failures = []
for label, source in [("send", SEND), ("receive", RECEIVE)]:
    if "PINManager.verifyTransactionPIN" not in source:
        failures.append(f"{label} does not use the existing transaction PIN verifier")
    if "BiometricManager.verify" not in source:
        failures.append(f"{label} does not offer biometric authorization")
    if '<InputOTPSlot index={0} mask />' not in source:
        failures.append(f"{label} transaction PIN is not masked")

if "if (step !== 'pin') setPin('');" not in SEND:
    failures.append("send transaction PIN is not cleared after leaving authorization")
if "if (receiveStep !== 'africa-auth') setCollectionPin('');" not in RECEIVE:
    failures.append("receive transaction PIN is not cleared after leaving authorization")

if "issueTransactionAuthorization" in VERIFY_PIN:
    failures.append("PIN verification was coupled to sandbox transaction token issuance")
if "issueTransactionAuthorization" in WEBAUTHN:
    failures.append("biometric verification was coupled to sandbox transaction token issuance")
if ".delete()" in VERIFY_PIN or ".upsert(" in VERIFY_PIN:
    failures.append("PIN verification may replace or delete an existing security factor")
if ".delete()" in WEBAUTHN or ".upsert(" in WEBAUTHN:
    failures.append("biometric verification may replace or delete an existing credential")
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

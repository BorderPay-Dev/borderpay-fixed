#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
authorize = (ROOT / "supabase/functions/sca-authorize/index.ts").read_text()
scope = (ROOT / "supabase/functions/sca-scope/index.ts").read_text()
transfer = (ROOT / "supabase/functions/bridge-transfer/index.ts").read_text()
send = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
api = (ROOT / "utils/api/backendAPI.ts").read_text()

checks = {
    "scope is server-derived": 'resolveBridgeScaScope(supabase, user.id, "payment")' in authorize,
    "released-client scope endpoint is restored": "resolveBridgeScaScope(supabase, user.id)" in scope,
    "SCA kill switch is respected": "bridgeEeaScaEnforcementEnabled()" in authorize,
    "non-EEA bypasses challenge": 'required: false, reason: scope.reason' in authorize,
    "PIN is verified before TOTP": authorize.find('verifyFactor("verify-pin"') < authorize.find('verifyFactor("verify-2fa"'),
    "authorization is bound to exact payload": 'scaPayloadHash(resource, body.request)' in authorize and 'const resource = payment ? "bridge_transfer" : "bridge_external_account"' in authorize,
    "two factors are recorded": 'verified_factors: ["pin", "totp"]' in authorize,
    "authorization expires": "expires_at: expiresAt" in authorize,
    "client uses separate PIN and TOTP steps": "| 'pin' | 'totp' |" in send and "step === 'totp'" in send,
    "client performs SCA scope preflight": "backendAPI.sca.status()" in send,
    "client requests payment authorization": "backendAPI.sca.authorizePayment" in send,
    "transfer rejection continues to TOTP without repeating PIN": (
        "code === 'sca_required'" in send
        and "verifiedScaPinRef.current ? 'totp' : 'pin'" in send
    ),
    "released authorization contract remains accepted": '(body.action && body.action !== "authorize")' in authorize,
    "stablecoin payout sends authorization": "sca_authorization_id: scaAuthorizationId" in send,
    "API wrapper preserves authorization": "sca_authorization_id?: string" in api,
    "transfer consumes one-time authorization": "consumeScaAuthorization" in transfer,
    "provider receives compliant attestation": 'outcome: "sca_used"' in transfer,
    "authorization checks the unmodified client request": (
        "const scaAuthorizedRequest = structuredClone(body)" in transfer
        and "request: scaAuthorizedRequest" in transfer
    ),
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"[{'PASS' if passed else 'FAIL'}] {name}")
print(f"eea_payout_sca_challenge_audit: {len(checks) - len(failed)}/{len(checks)}")
raise SystemExit(1 if failed else 0)

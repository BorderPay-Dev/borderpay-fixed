#!/usr/bin/env python3
"""
webauthn_v10_shape_audit — pin the WebAuthn verify functions to the
@simplewebauthn/server@10 result/input shapes.

Background
----------
Both verify functions import @simplewebauthn/server@10.0.0 but previously used
the v11 object shapes:
  • register-verify read `registrationInfo.credential.{id,publicKey}` (v11);
    v10 returns them FLAT: registrationInfo.credentialID (Base64URLString) /
    credentialPublicKey (Uint8Array) / counter / credentialDeviceType /
    credentialBackedUp. Under v10 `credential` was undefined → 500.
  • auth-verify passed `credential: { id, publicKey }` (v11) to
    verifyAuthenticationResponse; v10 expects `authenticator: { credentialID,
    credentialPublicKey, counter, transports }`.

These invariants fail closed so the code can't drift back to the v11 shape
without also (intentionally) bumping the pinned version.

Run: python3 tests/audit/webauthn_v10_shape_audit.py
Exit 0 = pass, 1 = fail.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REG = os.path.join(ROOT, "supabase", "functions", "webauthn-register-verify", "index.ts")
AUTH = os.path.join(ROOT, "supabase", "functions", "webauthn-auth-verify", "index.ts")


def main() -> int:
    for p in (REG, AUTH):
        if not os.path.exists(p):
            print(f"webauthn_v10_shape_audit: source not found at {p}")
            return 1
    reg = open(REG, encoding="utf-8").read()
    auth = open(AUTH, encoding="utf-8").read()

    checks = [
        # Version stays pinned at v10 in both (no unproven bump).
        ("S1 register-verify pins @simplewebauthn/server@10.0.0",
         "@simplewebauthn/server@10.0.0" in reg,
         "expected @simplewebauthn/server@10.0.0 import"),
        ("S2 auth-verify pins @simplewebauthn/server@10.0.0",
         "@simplewebauthn/server@10.0.0" in auth,
         "expected @simplewebauthn/server@10.0.0 import"),

        # register-verify reads the v10 flat fields off registrationInfo.
        ("S3 register-verify reads registrationInfo.credentialID",
         bool(re.search(r"credentialID", reg)) and "registrationInfo" in reg,
         "expected credentialID from registrationInfo"),
        ("S4 register-verify reads credentialPublicKey",
         "credentialPublicKey" in reg,
         "expected credentialPublicKey from registrationInfo"),

        # auth-verify passes the v10 `authenticator` input (not `credential`).
        ("S5 auth-verify passes authenticator: { credentialID, credentialPublicKey }",
         bool(re.search(r"authenticator\s*:\s*\{", auth)) and "credentialID" in auth and "credentialPublicKey" in auth,
         "expected authenticator object with credentialID/credentialPublicKey"),

        # Regression guards: the v11 shapes must NOT reappear.
        ("S6 no v11 registrationInfo.credential.* in register-verify",
         not re.search(r"registrationInfo\s*\.\s*credential\b", reg)
         and not re.search(r"const\s*\{[^}]*\bcredential\b[^}]*\}\s*=\s*verification\.registrationInfo", reg),
         "register-verify must not destructure registrationInfo.credential (v11 shape)"),
        ("S7 no v11 `credential:` input in auth-verify verify call",
         not re.search(r"verifyAuthenticationResponse\(\s*\{(?:[^}]|\}(?!\s*\)))*?\bcredential\s*:", auth, re.S),
         "auth-verify must pass `authenticator:`, not `credential:`"),
    ]

    print("webauthn_v10_shape_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

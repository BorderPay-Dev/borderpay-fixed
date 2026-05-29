#!/usr/bin/env python3
"""
bridge_webhook_signature_audit — structural audit of the bridge-webhook
signature verification path.

Why this exists
---------------
Bridge signs webhooks over the SHA-256 *digest* of `${timestamp}.${rawBody}`
and then RSA-SHA256-verifies that digest (their Node sample:
`createHash('sha256').update(signedPayload).digest()` ->
`createVerify('RSA-SHA256').update(digest).verify(...)`).

WebCrypto's `crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data)` hashes
`data` once under SHA-256 before the PKCS#1 v1.5 compare. To reproduce Bridge's
double hash we must therefore pass the **digest bytes** as `data` — passing the
raw payload string only single-hashes and fails 100% of the time (the symptom
that left an approved user stuck `pending`: 37/37 events `signature_ok=false`).

These invariants fail closed: if someone reverts to verifying the raw payload
string, or re-stringifies the timestamp via Number(), the audit breaks.

Run: python3 tests/audit/bridge_webhook_signature_audit.py
Exit 0 = pass, 1 = fail.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "supabase", "functions", "bridge-webhook", "index.ts")


def fail(checks):
    bad = [c for c in checks if not c[1]]
    for name, ok, detail in [(c[0], c[1], c[2]) for c in checks]:
        print(f"  [{'OK' if ok else 'XX'}] {name}" + ("" if ok else f"  -> {detail}"))
    return len(bad) == 0


def main() -> int:
    if not os.path.exists(SRC):
        print(f"bridge_webhook_signature_audit: source not found at {SRC}")
        return 1
    code = open(SRC, encoding="utf-8").read()

    # Isolate the verifySignature body for precise checks.
    m = re.search(r"async function verifySignature\([^)]*\)\s*:\s*Promise<boolean>\s*\{(.*?)\n\}", code, re.S)
    vbody = m.group(1) if m else ""

    checks = [
        # S1: signed payload uses the RAW timestamp string (tsRaw), never Number(ts) re-stringified.
        ("S1 signedPayload uses tsRaw (raw header timestamp)",
         bool(re.search(r"`\$\{tsRaw\}\.\$\{rawBody\}`", vbody)),
         "expected `${tsRaw}.${rawBody}` in verifySignature"),

        # S2: a SHA-256 digest of the signed payload is computed.
        ("S2 computes SHA-256 digest of signed payload",
         bool(re.search(r'crypto\.subtle\.digest\(\s*"SHA-256"', vbody)),
         "expected crypto.subtle.digest(\"SHA-256\", signedPayload)"),

        # S3: the DIGEST (not the raw payload string) is the message passed to verify().
        ("S3 verify() receives the digest bytes",
         bool(re.search(r'crypto\.subtle\.verify\(\s*"RSASSA-PKCS1-v1_5"\s*,\s*key\s*,\s*sig\s*,\s*digest\s*\)', vbody)),
         "expected verify(\"RSASSA-PKCS1-v1_5\", key, sig, digest)"),

        # S4: signature scheme is RSASSA-PKCS1-v1_5.
        ("S4 scheme is RSASSA-PKCS1-v1_5",
         "RSASSA-PKCS1-v1_5" in vbody,
         "expected RSASSA-PKCS1-v1_5 in verifySignature"),

        # S5: caller passes parsed.tsRaw (not parsed.ts) into verifySignature.
        ("S5 caller passes parsed.tsRaw",
         bool(re.search(r"verifySignature\(\s*rawBody\s*,\s*parsed\.tsRaw\s*,\s*parsed\.sig\s*\)", code)),
         "expected verifySignature(rawBody, parsed.tsRaw, parsed.sig)"),

        # S6: parseSigHeader exposes tsRaw.
        ("S6 parseSigHeader returns tsRaw",
         bool(re.search(r"parseSigHeader\([^)]*\)\s*:\s*\{[^}]*tsRaw\s*:\s*string", code)),
         "expected parseSigHeader return type to include tsRaw: string"),

        # S7: raw body read before any JSON.parse (signature is over raw bytes).
        ("S7 raw body read via req.text() before JSON.parse",
         ("await req.text()" in code and
          (code.index("await req.text()") < code.index("JSON.parse") if "JSON.parse" in code else True)),
         "req.text() must precede any JSON.parse"),

        # S8: public key imported as SPKI with SHA-256 hash.
        ("S8 SPKI import + SHA-256 hash",
         bool(re.search(r'importKey\(\s*"spki"', code)) and 'hash: "SHA-256"' in code,
         "expected importKey(\"spki\", ...) with hash SHA-256"),

        # S9 (regression guard): the OLD single-hash form must be gone — verify()
        # must NOT be called directly on an encoded raw payload string.
        ("S9 no single-hash regression (verify over raw string)",
         not bool(re.search(r'verify\(\s*"RSASSA-PKCS1-v1_5"\s*,\s*key\s*,\s*sig\s*,\s*signed\s*\)', code))
         and not bool(re.search(r'verify\([^)]*,\s*new TextEncoder\(\)\.encode\(`\$\{ts', code)),
         "verify() must receive the digest, not the encoded raw payload"),
    ]

    print("bridge_webhook_signature_audit:")
    ok = fail(checks)
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

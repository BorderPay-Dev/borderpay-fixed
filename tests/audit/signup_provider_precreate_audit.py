#!/usr/bin/env python3
"""
Signup provider pre-create regression audit.

Signup must create the BorderPay app account and email-verification token only.
Provider customer creation belongs to the hosted KYC/KYB flow, where the user
has supplied the required identity/TOS fields. If signup imports the provider
adapter or calls createCustomer(), a provider rejection can block otherwise valid
users before email verification.
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUTH_SIGNUP = ROOT / "supabase" / "functions" / "auth-signup" / "index.ts"


def main() -> int:
    src = AUTH_SIGNUP.read_text(encoding="utf-8")
    checks: list[tuple[str, bool, str]] = [
        (
            "auth-signup does not import provider customer adapter",
            "providers/bridge.ts" not in src and "bridgeProvider" not in src,
            "signup must not import or reference provider customer creation",
        ),
        (
            "auth-signup does not call createCustomer",
            ".createCustomer(" not in src and "createCustomer(" not in src,
            "signup must not call provider createCustomer before hosted verification",
        ),
        (
            "auth-signup still keeps country compliance gate",
            "isBridgeBlocked(normalizedCountryCode)" in src and "country_not_supported" in src,
            "country block must remain before account creation",
        ),
        (
            "auth-signup returns null provider id at signup",
            "const bridgeCustomerId: string | null = null;" in src,
            "signup response should not pretend a provider customer exists",
        ),
    ]

    print("signup_provider_precreate_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

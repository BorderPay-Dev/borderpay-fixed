#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

signup = (ROOT / "components/auth/SignUpFlow.tsx").read_text()
api = (ROOT / "utils/api/backendAPI.ts").read_text()
edge = (ROOT / "supabase/functions/auth-signup/index.ts").read_text()

checks = [
    (
        "frontend validation does not require phone",
        "if (!fullName || !email || !password || !confirmPassword)" in signup
        and "if (!fullName || !email || !phone || !password || !confirmPassword)" not in signup,
    ),
    (
        "frontend sends phone only when provided",
        "phone_number: phone ? `${selectedCountry?.dialCode}${phone}` : undefined" in signup,
    ),
    (
        "signup screen labels phone optional",
        "Phone Number <span" in signup and "(optional)" in signup,
    ),
    (
        "review screen hides blank phone",
        "{formData.phone ? (" in signup and '<ReviewRow label="Phone"' in signup,
    ),
    (
        "api helper accepts missing phone",
        "phone_number?: string;" in api,
    ),
    (
        "edge function normalizes optional phone",
        "const normalizedPhone = String(phone_number || \"\").trim();" in edge,
    ),
    (
        "edge function omits blank phone from auth metadata",
        "...(normalizedPhone ? { phone: normalizedPhone } : {})" in edge,
    ),
]

failed = [name for name, ok in checks if not ok]
if failed:
    print("signup_phone_optional_app_review_audit: FAIL")
    for name in failed:
        print(f"- {name}")
    raise SystemExit(1)

print(f"signup_phone_optional_app_review_audit: PASS ({len(checks)}/{len(checks)})")

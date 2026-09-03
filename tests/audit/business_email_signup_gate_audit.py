#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
signup = (ROOT / "supabase/functions/auth-signup/index.ts").read_text()
policy = (ROOT / "supabase/functions/_shared/business-email-policy.ts").read_text()

checks = {
    "server imports policy": 'evaluateBusinessEmail' in signup,
    "gate applies only after business account decision": 'if (normalizedAccountType === "business")' in signup,
    "gate runs before auth identity creation": signup.index("evaluateBusinessEmail(email, normalizedCountryCode)") < signup.index("auth.admin.createUser"),
    "stable error code": 'code: "business_email_required"' in signup,
    "personal domains rejected": '"gmail.com"' in policy and '"inbox.eu"' in policy,
    "inbox.eu exception is UK-only": 'domain === "inbox.eu"' in policy and 'country === "GB"' in policy,
    "disposable domains rejected": '"mailinator"' in policy,
    "reserved domains rejected": 'domain.endsWith(".test")' in policy,
    "confirmed hostile identities rejected": 'tst@hacker.com' in policy and 'loadtest_' in policy,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"[{'OK' if ok else 'FAIL'}] {name}")
if failed:
    raise SystemExit(f"business_email_signup_gate_audit: FAIL ({len(failed)} checks)")
print(f"business_email_signup_gate_audit: PASS ({len(checks)}/{len(checks)})")

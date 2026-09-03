from pathlib import Path

root = Path(__file__).resolve().parents[2]
source = (root / "supabase/functions/auth-signup/index.ts").read_text()

checks = {
    "bounded edge cache": (
        "EDGE_RATE_MAX_KEYS = 10_000" in source
        and "while (edgeRateBuckets.size > EDGE_RATE_MAX_KEYS)" in source
    ),
    "edge limiter before database RPC": (
        source.find("checkEdgeRateLimit(edgeKeys)")
        < source.find('supabaseAdmin.rpc("enforce_signup_abuse_protection"')
    ),
    "business email gate before database RPC": (
        source.find("evaluateBusinessEmail(email, normalizedCountryCode)")
        < source.find('supabaseAdmin.rpc("enforce_signup_abuse_protection"')
    ),
    "captcha before database RPC": (
        source.find("verifySignupCaptcha(captchaToken, requestIp)")
        < source.find('supabaseAdmin.rpc("enforce_signup_abuse_protection"')
    ),
    "rate response does not expose identity": (
        'code: "rate_limited"' in source
        and 'error: "Too many signup attempts. Please wait and try again."' in source
    ),
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"[{'OK' if passed else 'FAIL'}] {name}")

if failed:
    raise SystemExit(f"signup_edge_pressure_valve_audit: FAIL ({', '.join(failed)})")

print(f"signup_edge_pressure_valve_audit: PASS ({len(checks)}/{len(checks)})")

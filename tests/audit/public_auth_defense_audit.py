#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


shared = read("supabase/functions/_shared/public-request-security.ts")
signup = read("supabase/functions/auth-signup/index.ts")
resend = read("supabase/functions/auth-resend-verification/index.ts")
reset = read("supabase/functions/auth-reset-password/index.ts")
client = read("utils/security/recaptchaEnterprise.ts")
app_check_client = read("utils/security/firebaseAppCheck.ts")
app_check_server = read("supabase/functions/_shared/firebase-app-check.ts")
api = read("utils/api/backendAPI.ts")
config = read("supabase/config.toml")
package = read("package.json")
capacitor = read("capacitor.config.ts")

cf = shared.find('req.headers.get("cf-connecting-ip")')
real = shared.find('req.headers.get("x-real-ip")')
forwarded = shared.find('req.headers.get("x-forwarded-for")')

checks = {
    "trusted ingress IP precedence": 0 <= cf < real < forwarded,
    "bounded JSON rejects wrong content type": "unsupported_media_type" in shared,
    "bounded JSON rejects oversized bodies": "payload_too_large" in shared and "TextEncoder" in shared,
    "signup uses shared bounded envelope": "readBoundedJson<SignupBody>(req)" in signup,
    "signup uses trusted client IP": "extractPublicClientIp(req)" in signup,
    "resend uses bounded input and trusted IP": "readBoundedJson" in resend and "extractPublicClientIp(req)" in resend,
    "reset uses bounded input": "readBoundedJson" in reset,
    "Enterprise assessment uses expected action": "expectedAction: SIGNUP_CAPTCHA_ACTION" in signup,
    "Enterprise assessment checks returned action": "action !== SIGNUP_CAPTCHA_ACTION" in signup,
    "Enterprise assessment checks hostname": "RECAPTCHA_ALLOWED_HOSTNAMES.has(hostname)" in signup,
    "Enterprise assessment checks risk score": "score < RECAPTCHA_MIN_SCORE" in signup,
    "Enterprise credential is sent in a header, not URL": "X-Goog-Api-Key" in signup and "?key=" not in signup,
    "required CAPTCHA fails closed without credentials": "captcha_not_configured" in signup and "captchaIsRequired()" in signup,
    "web token uses action-specific execute": "enterprise.execute(SITE_KEY, { action })" in client,
    "browser key is not used by native runtime": "isNativeRuntime()" in client,
    "signup payload forwards CAPTCHA token": "captcha_token: captchaToken" in api,
    "native signup sends Firebase App Check": "X-Firebase-AppCheck" in api and "getNativeAppCheckToken" in api,
    "App Check verifies RSA signature": "crypto.subtle.verify" in app_check_server and 'header.alg !== "RS256"' in app_check_server,
    "App Check validates issuer audience and app ID": all(
        marker in app_check_server
        for marker in ("payload.iss", "audiences.includes", "allowedAppIds.has")
    ),
    "native App Check uses production attestation": "debugToken" not in app_check_client and "isTokenAutoRefreshEnabled: true" in app_check_client,
    "native App Check plugin is release-pinned": '"@capacitor-firebase/app-check": "8.5.1"' in package,
    "iOS App Check uses the Capacitor SPM bridge": "'@capacitor-firebase/app-check': { symlink: true }" in capacitor,
    "emergency signup kill switch precedes parsing": signup.find("SIGNUP_ENABLED") < signup.find("readBoundedJson<SignupBody>(req)"),
    "direct signup remains business-only": (
        "business_signup_only" in signup
        and 'normalizedAccountType !== "business" && !onboardingToken' in signup
    ),
    "signed partner onboarding remains supported": (
        "verifyOnboardingToken(" in signup
        and "consume_api_onboarding_authorization" in signup
        and "untrusted_onboarding_context" in signup
    ),
    "country is explicit and Ukraine is excluded pending region screening": (
        'String(country_code || "")' in signup
        and 'normalizedCountryCode === "UA"' in signup
        and "isBridgeBlocked(normalizedCountryCode)" in signup
    ),
    "warm-isolate limiter precedes provider and database work": (
        "checkEdgeRateLimit(edgeKeys)" in signup
        and signup.find("checkEdgeRateLimit(edgeKeys)") < signup.find("verifyFirebaseAppCheckToken(appCheckToken)")
        and signup.find("checkEdgeRateLimit(edgeKeys)") < signup.find('supabaseAdmin.rpc("enforce_signup_abuse_protection"')
    ),
    "CAPTCHA or App Check precedes database abuse RPC": (
        signup.find("verifySignupCaptcha(captchaToken")
        < signup.find('supabaseAdmin.rpc("enforce_signup_abuse_protection"')
    ),
    "public auth routes are explicitly pinned": all(
        f"[functions.{name}]\nverify_jwt = false" in config
        for name in ("auth-signup", "auth-resend-verification", "verify-email-token")
    ),
    "CAPTCHA token is not logged": not any(
        "captcha_token" in line and ("console." in line or "JSON.stringify" in line)
        for line in signup.splitlines()
    ),
    "App Check token is not logged": not any(
        "appCheckToken" in line and "console." in line
        for line in signup.splitlines() + api.splitlines()
    ),
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit("public auth defense audit failed: " + ", ".join(failed))
print(f"public auth defense audit passed ({len(checks)}/{len(checks)}).")

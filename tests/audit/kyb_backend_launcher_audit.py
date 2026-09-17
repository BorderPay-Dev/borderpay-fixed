#!/usr/bin/env python3
"""P0 regression gate for secure cross-platform KYB launching."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
kyb = (ROOT / "supabase/functions/bridge-kyb-link/index.ts").read_text()
url_guard = (ROOT / "supabase/functions/_shared/bridge-verification-url.ts").read_text()
app = (ROOT / "App.tsx").read_text()
vercel = (ROOT / "vercel.json").read_text()
checks = {
    "callback origin is resolved from recorded customer ownership": "customerAppOrigin(supa, user.id, APP_URL)" in kyb,
    "new and existing customers receive the current provider URL": "verifiedHostedLink(customerOrigin, link.link_url)" in kyb and "link_url: clientLinkUrl" in kyb,
    "only the approved identity host is accepted": 'const PERSONA_HOST = "bridge.withpersona.com"' in url_guard and "host.endsWith(`.${PERSONA_HOST}`)" in url_guard,
    "KYB URL is not wrapped in an intermediate launcher": "verification_launch_tokens" not in kyb and "/verification/continue?token=" not in kyb,
    "client receives the validated provider URL": "return target.toString()" in url_guard,
    "launcher Edge function is absent": not (ROOT / "supabase/functions/verification-launch/index.ts").exists(),
    "launcher SPA page is absent": not (ROOT / "components/verification/VerificationContinuePage.tsx").exists(),
    "launcher route is absent": "VerificationContinuePage" not in app and "'/verification/continue'" not in app,
    "native callback cannot use an internal WebView origin": "verificationRedirectUrl(customerOrigin, body.redirect_url)" in kyb and "capacitor://localhost" in url_guard,
    "external callback is pinned to the exact BorderPay HTTPS origin": 'parsed.protocol === "https:"' in url_guard and "parsed.origin === app.origin" in url_guard,
    "cached provider links have their native callback replaced": 'target.searchParams.set("redirect-uri", verificationRedirectUrl(appUrl))' in url_guard,
    "normalized KYB URL is persisted instead of the provider raw URL": "bridge_kyb_link_url: clientLinkUrl" in kyb,
    "legacy callback spelling is removed": 'target.searchParams.delete("redirect_uri")' in url_guard,
    "Vercel does not proxy HTML from Supabase": '"source": "/verification/continue"' not in vercel,
    "KYB backend cannot emit launcher HTML": "<!doctype html>" not in kyb and "text/html" not in kyb,
    "ToS remains separately represented": "tos_link_url: tosRequired ? link.tos_link_url : null" in kyb,
    "existing customers fetch the current Bridge URL first": kyb.find("if (existingCustomerId) {") < kyb.find("Compatibility fallback only when the authoritative customer-resume route"),
    "stored link is fallback only": "Compatibility fallback only when the authoritative customer-resume route" in kyb,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("kyb_backend_launcher_audit: FAIL\n- " + "\n- ".join(failed))
print(f"kyb_backend_launcher_audit: PASS ({len(checks)}/{len(checks)})")

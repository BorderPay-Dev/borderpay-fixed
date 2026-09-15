#!/usr/bin/env python3
"""P0 regression gate for secure cross-platform KYB launching."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
kyb = (ROOT / "supabase/functions/bridge-kyb-link/index.ts").read_text()
app = (ROOT / "App.tsx").read_text()
vercel = (ROOT / "vercel.json").read_text()
checks = {
    "new and existing customers receive the current provider URL": "verifiedHostedLink(link.link_url)" in kyb and "link_url: clientLinkUrl" in kyb,
    "only the approved identity host is accepted": "host !== \"bridge.withpersona.com\"" in kyb and "host.endsWith(\".withpersona.com\")" in kyb,
    "KYB URL is not wrapped in an intermediate launcher": "verification_launch_tokens" not in kyb and "/verification/continue?token=" not in kyb,
    "client receives the validated provider URL": "return target.toString()" in kyb,
    "launcher Edge function is absent": not (ROOT / "supabase/functions/verification-launch/index.ts").exists(),
    "launcher SPA page is absent": not (ROOT / "components/verification/VerificationContinuePage.tsx").exists(),
    "launcher route is absent": "VerificationContinuePage" not in app and "'/verification/continue'" not in app,
    "native callback cannot use an internal WebView origin": "verificationRedirectUrl(body.redirect_url)" in kyb and "capacitor://localhost" in kyb,
    "external callback is pinned to BorderPay HTTPS": 'parsed.protocol === "https:"' in kyb and "parsed.hostname === app.hostname" in kyb,
    "cached provider links have their native callback replaced": 'target.searchParams.set("redirect-uri", verificationRedirectUrl(undefined))' in kyb,
    "legacy callback spelling is removed": 'target.searchParams.delete("redirect_uri")' in kyb,
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

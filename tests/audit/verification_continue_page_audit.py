#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGE = (ROOT / "components/verification/VerificationContinuePage.tsx").read_text()
EDGE = (ROOT / "supabase/functions/verification-launch/index.ts").read_text()
KYB = (ROOT / "supabase/functions/bridge-kyb-link/index.ts").read_text()
APP = (ROOT / "App.tsx").read_text()
VERCEL = (ROOT / "vercel.json").read_text()

checks = {
    "public route bypasses authentication bootstrap": APP.index("if (isVerificationContinue)") < APP.index("<AppContent />"),
    "route is exact": "=== '/verification/continue'" in APP,
    "branded page has no provider branding": "Bridge" not in PAGE and "Supabase" not in PAGE,
    "page never renders response text": ".text()" not in PAGE and "response.json()" in PAGE,
    "page rejects invalid UUID tokens": "/^[0-9a-f-]{36}$/i.test(token)" in PAGE,
    "page requests only the token exchange endpoint": "/functions/v1/verification-launch?token=" in PAGE,
    "page validates HTTPS provider host": "target.protocol !== 'https:'" in PAGE,
    "page validates Persona host": "bridge.withpersona.com" in PAGE and ".withpersona.com" in PAGE,
    "page presents explicit continue CTA": "Continue verification" in PAGE and "href={state.targetUrl}" in PAGE,
    "edge returns JSON only": "application/json; charset=utf-8" in EDGE and "text/html" not in EDGE,
    "edge allows only known app origins": "ALLOWED_ORIGINS" in EDGE,
    "edge validates token expiry": "Date.parse(data.expires_at) <= Date.now()" in EDGE,
    "edge validates HTTPS provider host": 'target.protocol !== "https:"' in EDGE,
    "edge validates Persona host": 'host !== "bridge.withpersona.com"' in EDGE,
    "edge response cannot be cached": '"Cache-Control": "no-store, max-age=0"' in EDGE,
    "Vercel serves the SPA for continue route": '"source": "/verification/continue"' not in VERCEL,
    "business KYB bypasses the legacy launcher": "verification_launch_tokens" not in KYB and "verifiedHostedLink(link.link_url)" in KYB,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(("PASS" if ok else "FAIL") + ": " + name)
if failed:
    raise SystemExit("verification continue audit failed: " + ", ".join(failed))
print(f"PASS: {len(checks)}/{len(checks)} verification continue checks passed")

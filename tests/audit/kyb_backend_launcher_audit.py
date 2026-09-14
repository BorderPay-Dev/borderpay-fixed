#!/usr/bin/env python3
"""P0 regression gate for released-app KYB URL compatibility."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
kyb = (ROOT / "supabase/functions/bridge-kyb-link/index.ts").read_text()
launcher = (ROOT / "supabase/functions/verification-launch/index.ts").read_text()
migration = (ROOT / "supabase/migrations/20260914183000_verification_launch_tokens.sql").read_text()

checks = {
    "KYB returns launcher rather than raw provider URL": "link_url: externalLaunchUrl" in kyb,
    "launcher tokens expire in ten minutes": "10 * 60 * 1000" in kyb,
    "raw URL is stored server-side": 'target_url: target.toString()' in kyb,
    "launcher cannot accept arbitrary target URL": 'searchParams.get("token")' in launcher and 'searchParams.get("url")' not in launcher,
    "provider host allowlist enforced twice": "withpersona.com" in kyb and "withpersona.com" in launcher,
    "released native clients open the system browser": 'target="_blank"' in launcher and 'rel="noopener noreferrer"' in launcher,
    "provider is never opened inside the app WebView": 'target="_top"' not in launcher,
    "launcher response cannot be cached": 'Cache-Control": "no-store' in launcher,
    "token table is private": "revoke all on public.verification_launch_tokens from anon, authenticated" in migration,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("kyb_backend_launcher_audit: FAIL\n- " + "\n- ".join(failed))
print(f"kyb_backend_launcher_audit: PASS ({len(checks)}/{len(checks)})")

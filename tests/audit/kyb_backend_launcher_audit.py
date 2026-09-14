#!/usr/bin/env python3
"""P0 regression gate for released-app KYB URL compatibility."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
kyb = (ROOT / "supabase/functions/bridge-kyb-link/index.ts").read_text()
launcher = (ROOT / "supabase/functions/verification-launch/index.ts").read_text()
migration = (ROOT / "supabase/migrations/20260914183000_verification_launch_tokens.sql").read_text()
checks = {
    "new customers retain the direct provider handoff": "let clientLinkUrl = link.link_url" in kyb,
    "existing customers receive the compatibility launcher": "existingCustomerId && link.link_url" in kyb and "createExternalLaunchUrl" in kyb,
    "launcher tokens expire in ten minutes": "10 * 60 * 1000" in kyb,
    "launcher cannot accept an arbitrary destination": 'searchParams.get("token")' in launcher and 'searchParams.get("url")' not in launcher,
    "provider host is allowlisted twice": "withpersona.com" in kyb and "withpersona.com" in launcher,
    "released embedded clients can leave the iframe": 'target="_top"' in launcher,
    "launcher token table is private": "revoke all on public.verification_launch_tokens from anon, authenticated" in migration,
    "raw provider URL remains internal until authenticated response": "bridge_kyb_link_url: link.link_url" in kyb,
    "ToS remains separately represented": "tos_link_url: tosRequired ? link.tos_link_url : null" in kyb,
    "existing customers fetch the current Bridge URL first": kyb.find("if (existingCustomerId) {") < kyb.find("if ((!r.ok || (!link?.link_url && !link?.tos_link_url)) && biz.bridge_kyb_link_id)"),
    "stored link is fallback only": "Compatibility fallback only when the authoritative customer-resume route" in kyb,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("kyb_backend_launcher_audit: FAIL\n- " + "\n- ".join(failed))
print(f"kyb_backend_launcher_audit: PASS ({len(checks)}/{len(checks)})")

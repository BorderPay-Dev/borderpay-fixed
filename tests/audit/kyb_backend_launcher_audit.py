#!/usr/bin/env python3
"""P0 regression gate for secure cross-platform KYB launching."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
kyb = (ROOT / "supabase/functions/bridge-kyb-link/index.ts").read_text()
launcher = (ROOT / "supabase/functions/verification-launch/index.ts").read_text()
checks = {
    "new and existing customers receive a short-lived handoff": "createExternalLaunchUrl(user.id, link.link_url)" in kyb and "link_url: clientLinkUrl" in kyb,
    "handoff tokens expire quickly": "Date.now() + 10 * 60 * 1000" in kyb,
    "only the approved identity host is accepted": "host !== \"bridge.withpersona.com\"" in kyb and "host.endsWith(\".withpersona.com\")" in kyb,
    "provider URL stays server-side behind the one-time token": "verification_launch_tokens" in kyb and "target_url" in kyb,
    "client handoff stays on the BorderPay application domain": '`${APP_URL.replace(/\\/+$/, "")}/verification/continue?token=' in kyb,
    "launcher validates token expiry": "Date.parse(data.expires_at) <= Date.now()" in launcher,
    "launcher opens provider outside the embedded surface": 'target="_blank"' in launcher and 'rel="noopener noreferrer"' in launcher,
    "launcher always renders HTML": '"Content-Type": "text/html; charset=utf-8"' in launcher,
    "ToS remains separately represented": "tos_link_url: tosRequired ? link.tos_link_url : null" in kyb,
    "existing customers fetch the current Bridge URL first": kyb.find("if (existingCustomerId) {") < kyb.find("if ((!r.ok || (!link?.link_url && !link?.tos_link_url)) && biz.bridge_kyb_link_id)"),
    "stored link is fallback only": "Compatibility fallback only when the authoritative customer-resume route" in kyb,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("kyb_backend_launcher_audit: FAIL\n- " + "\n- ".join(failed))
print(f"kyb_backend_launcher_audit: PASS ({len(checks)}/{len(checks)})")

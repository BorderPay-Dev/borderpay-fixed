#!/usr/bin/env python3
"""P0 regression gate for released-app KYB URL compatibility."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
kyb = (ROOT / "supabase/functions/bridge-kyb-link/index.ts").read_text()
checks = {
    "KYB returns the provider URL directly": "link_url: link.link_url" in kyb,
    "KYB does not return an HTML launcher": "externalLaunchUrl" not in kyb and "verification-launch" not in kyb,
    "raw provider URL remains internal until authenticated response": "bridge_kyb_link_url: link.link_url" in kyb,
    "ToS remains separately represented": "tos_link_url: tosRequired ? link.tos_link_url : null" in kyb,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("kyb_backend_launcher_audit: FAIL\n- " + "\n- ".join(failed))
print(f"kyb_backend_launcher_audit: PASS ({len(checks)}/{len(checks)})")

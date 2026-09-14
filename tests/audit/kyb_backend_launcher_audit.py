#!/usr/bin/env python3
"""P0 regression gate for direct provider KYB URL compatibility."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
kyb = (ROOT / "supabase/functions/bridge-kyb-link/index.ts").read_text()
checks = {
    "new and existing customers receive the direct provider handoff": "link_url: link.link_url" in kyb,
    "HTML launcher is never returned as the KYB URL": "createExternalLaunchUrl" not in kyb and "clientLinkUrl" not in kyb,
    "raw provider URL remains internal until authenticated response": "bridge_kyb_link_url: link.link_url" in kyb,
    "ToS remains separately represented": "tos_link_url: tosRequired ? link.tos_link_url : null" in kyb,
    "existing customers fetch the current Bridge URL first": kyb.find("if (existingCustomerId) {") < kyb.find("if ((!r.ok || (!link?.link_url && !link?.tos_link_url)) && biz.bridge_kyb_link_id)"),
    "stored link is fallback only": "Compatibility fallback only when the authoritative customer-resume route" in kyb,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("kyb_backend_launcher_audit: FAIL\n- " + "\n- ".join(failed))
print(f"kyb_backend_launcher_audit: PASS ({len(checks)}/{len(checks)})")

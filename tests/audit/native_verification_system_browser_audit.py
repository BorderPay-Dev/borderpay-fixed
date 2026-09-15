#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
package = (root / "package.json").read_text()
screen = (root / "components/kyc/KYCVerification.tsx").read_text()

checks = {
    "official Browser plugin is installed": '"@capacitor/browser"' in package,
    "verification imports Browser plugin": "import { Browser } from '@capacitor/browser'" in screen,
    "native verification opens system browser": "Browser.open({ url, presentationStyle: 'popover' })" in screen,
    "Persona is never opened with window.open": "window.open(url" not in screen,
    "web and PWA remain top-level": "window.location.assign(url)" in screen,
    "embedded screen remains Terms-only": "openHostedVerificationUrl(r.data.tos_link_url" in screen,
    "KYB remains external": "openHostedVerificationUrl(r.data.link_url" not in screen,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("FAIL: " + "; ".join(failed))
print(f"PASS: {len(checks)}/{len(checks)} native system-browser checks")

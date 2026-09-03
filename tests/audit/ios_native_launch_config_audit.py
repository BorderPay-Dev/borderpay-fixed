#!/usr/bin/env python3
"""Fail closed when an iOS native plugin can crash before web bootstrap."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONFIG = (ROOT / "capacitor.config.ts").read_text()
WORKFLOW = (ROOT / ".github/workflows/ios-testflight.yml").read_text()

required_ios_plugins = (
    "@aparajita/capacitor-biometric-auth",
    "@capacitor/filesystem",
    "@capacitor/share",
)

assert "includePlugins" in CONFIG, "iOS plugin allowlist is missing"
for plugin in required_ios_plugins:
    assert plugin in CONFIG, f"required iOS plugin missing from allowlist: {plugin}"

ios_block = CONFIG.split("ios:", 1)[1].split("android:", 1)[0]
assert "@capacitor-firebase/messaging" not in ios_block, (
    "Firebase Messaging must not be bundled on iOS without GoogleService-Info.plist"
)
assert "Verify generated iOS launch configuration" in WORKFLOW
assert "Upload iOS dSYM artifact" in WORKFLOW

print("iOS native launch configuration audit: PASS")

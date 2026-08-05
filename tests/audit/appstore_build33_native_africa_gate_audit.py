#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

workflow = (ROOT / ".github/workflows/ios-testflight.yml").read_text()
xcode = (ROOT / "ios/App/App.xcodeproj/project.pbxproj").read_text()
africa = (ROOT / "utils/africanRailsAccess.ts").read_text()

checks = [
    (
        "iOS workflow exposes explicit build_number input",
        "build_number:" in workflow and 'default: "34"' in workflow,
    ),
    (
        "iOS workflow resolves requested build number, not github.run_number env",
        "REQUESTED_BUILD_NUMBER: ${{ inputs.build_number }}" in workflow
        and "CURRENT_PROJECT_VERSION=\"${{ steps.ios-build.outputs.number }}\"" in workflow
        and "BUILD_NUMBER: ${{ github.run_number }}" not in workflow,
    ),
    (
        "iOS workflow rejects build 33 and below",
        'if [ "$BUILD_NUMBER" -le 33 ]; then' in workflow,
    ),
    (
        "Xcode project local build number is 34",
        xcode.count("CURRENT_PROJECT_VERSION = 34;") >= 2
        and "CURRENT_PROJECT_VERSION = 1;" not in xcode,
    ),
    (
        "African rails are blocked in native runtime",
        "import { isNativeRuntime } from './native/mobileRuntime';" in africa
        and "if (isNativeRuntime()) return false;" in africa,
    ),
]

failed = [name for name, ok in checks if not ok]
if failed:
    print("appstore_build33_native_africa_gate_audit: FAIL")
    for name in failed:
        print(f"- {name}")
    raise SystemExit(1)

print(f"appstore_build33_native_africa_gate_audit: PASS ({len(checks)}/{len(checks)})")

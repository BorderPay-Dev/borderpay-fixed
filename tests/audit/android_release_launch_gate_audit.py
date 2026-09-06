from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
workflow = (ROOT / ".github/workflows/android-play.yml").read_text()
script = (ROOT / "scripts/ci/android-release-launch-smoke.sh").read_text()

checks = {
    "release APK is built with the Play bundle": "assembleRelease bundleRelease" in workflow,
    "emulator action is commit-pinned": "reactivecircus/android-emulator-runner@a421e43855164a8197daf9d8d40fe71c6996bb0d" in workflow,
    "signed release is launched before upload": workflow.index("Cold-launch signed release") < workflow.index("Upload AAB artifact"),
    "release APK is installed": 'adb install -r "$apk_path"' in script,
    "launch waits for MainActivity": 'am start -W -n "$package_name/.MainActivity"' in script,
    "process survival is required": 'pidof "$package_name"' in script and 'if [[ -z "$pid" ]]' in script,
    "fatal startup logs fail the release": "FATAL EXCEPTION" in script and "exit 1" in script,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"[{'OK' if passed else 'FAIL'}] {name}")
if failed:
    raise SystemExit(f"android_release_launch_gate_audit: FAIL ({len(failed)}/{len(checks)})")
print(f"android_release_launch_gate_audit: PASS ({len(checks)}/{len(checks)})")

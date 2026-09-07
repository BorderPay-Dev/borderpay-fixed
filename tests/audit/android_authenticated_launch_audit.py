from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
source = (ROOT / "utils/notifications/nativePush.ts").read_text()
main = (ROOT / "components/app/MainApp.tsx").read_text()

checks = {
    "authenticated dashboard owns native push startup": "initializeNativePush" in main,
    "Android push startup is quarantined before Firebase Messaging": (
        "if (nativePlatform() === 'android') return () => undefined;" in source
        and source.index("if (nativePlatform() === 'android') return () => undefined;")
        < source.index("FirebaseMessaging.isSupported()")
    ),
    "iOS native push path remains available": "if (!isNativeRuntime()) return () => undefined;" in source,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"[{'OK' if passed else 'FAIL'}] {name}")
if failed:
    raise SystemExit(f"android_authenticated_launch_audit: FAIL ({len(failed)}/{len(checks)})")
print(f"android_authenticated_launch_audit: PASS ({len(checks)}/{len(checks)})")

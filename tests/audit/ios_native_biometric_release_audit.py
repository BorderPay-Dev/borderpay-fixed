from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SECURITY = (ROOT / "utils/security/SecurityManager.ts").read_text()
LOGIN = (ROOT / "components/auth/LoginScreen.tsx").read_text()
PACKAGE = (ROOT / "package.json").read_text()
LOCK = (ROOT / "package-lock.json").read_text()
PLIST = (ROOT / "ios/App/App/Info.plist").read_text()
APP_LOCK = (ROOT / "components/security/AppLockScreen.tsx").read_text()


def main() -> None:
    failures: list[str] = []

    if '"@aparajita/capacitor-biometric-auth"' not in PACKAGE:
        failures.append("native biometric package is absent from package.json")
    if 'node_modules/@aparajita/capacitor-biometric-auth' not in LOCK:
        failures.append("native biometric package is absent from package-lock.json")
    if "if (isNativeRuntime())" not in SECURITY:
        failures.append("SecurityManager does not route all native platforms to biometric auth")
    if "isNativeAndroid" in SECURITY or "authenticateNativeAndroid" in SECURITY:
        failures.append("SecurityManager still restricts biometric auth to Android")
    if "const nativeMobile = isNativeRuntime();" not in LOGIN:
        failures.append("native iOS biometric login is not routed through BiometricManager")
    if "NSFaceIDUsageDescription" not in PLIST:
        failures.append("iOS Face ID usage description is missing")
    if APP_LOCK.count("<InputOTPSlot index=") != 6 or APP_LOCK.count(" mask />") < 6:
        failures.append("app unlock PIN digits are not fully masked")

    if failures:
        raise SystemExit("\n".join(f"FAIL: {failure}" for failure in failures))

    print("PASS: iOS biometric paths and masked app-unlock PIN are wired")


if __name__ == "__main__":
    main()

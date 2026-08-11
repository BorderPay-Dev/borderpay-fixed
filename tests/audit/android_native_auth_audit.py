from pathlib import Path

root = Path(__file__).resolve().parents[2]
security = (root / "utils/security/SecurityManager.ts").read_text()
lock = (root / "components/security/AppLockScreen.tsx").read_text()
login = (root / "components/auth/LoginScreen.tsx").read_text()
app = (root / "App.tsx").read_text()
package = (root / "package.json").read_text()

assert "@aparajita/capacitor-biometric-auth" in package
assert "BiometricAuth.checkBiometry()" in security
assert "BiometricAuth.authenticate" in security
assert "isNativeRuntime()" in security
assert "restoreLockedSession" in lock
assert "supabase.auth.refreshSession({ refresh_token: refreshToken })" in lock
assert "await restoreLockedSession()" in lock
assert "isNativeRuntime()" in login
assert "clearAppLocked();\n            setAppLocked(false);" in app

print("Android native PIN and biometric gates passed.")

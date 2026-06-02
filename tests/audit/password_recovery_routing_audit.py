#!/usr/bin/env python3
"""
Password-recovery routing audit (PR #47).

Incident: clicking a Supabase password-reset link landed on the DASHBOARD, not the
reset form. Root cause: supabase-js (detectSessionInUrl) parses the recovery
session from the URL hash, clears the hash, and fires PASSWORD_RECOVERY — but the
app stored that session as a normal login (borderpay_token) and useAuth flipped
isAuthenticated → dashboard won, and the reset screen read an already-cleared hash.

Invariants (fail closed):

  (G1) client.ts handles the PASSWORD_RECOVERY event explicitly.
  (G2) client.ts stashes the recovery token + flag and dispatches the recovery
       event (so the app can route to reset), instead of treating it as login.
  (G3) client.ts exports the recovery helpers (isPasswordRecovery / getRecoveryToken
       / clearPasswordRecovery).
  (G4) useAuth gates isAuthenticated with !isPasswordRecovery() (recovery ≠ login →
       never dashboard).
  (G5) App.tsx routes a recovery session to reset-password: imports isPasswordRecovery,
       includes it in reset detection, and listens for borderpay:password_recovery.
  (G6) ResetPasswordScreen captures the token via getRecoveryToken() (hash is only a
       fallback) and clears the recovery session on exit.
  (G7) The service-worker cache version is bumped off v2.11.0 (PWA gets the fix).

Non-runtime: parses source as text. No deploy, no DB, no network.

Run: python3 tests/audit/password_recovery_routing_audit.py   (exit 0 = pass)
"""

from __future__ import annotations
import sys
from pathlib import Path

ROOT    = Path(__file__).resolve().parents[2]
CLIENT  = ROOT / "utils" / "supabase" / "client.ts"
USEAUTH = ROOT / "utils" / "auth" / "useAuth.ts"
APP     = ROOT / "App.tsx"
RPS     = ROOT / "components" / "auth" / "ResetPasswordScreen.tsx"
SW      = ROOT / "public" / "service-worker.js"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    client = read(CLIENT)
    useauth = read(USEAUTH)
    app = read(APP)
    rps = read(RPS)
    sw = read(SW)

    checks: list[tuple[str, bool, str]] = []

    checks.append(("G1 client handles PASSWORD_RECOVERY event",
                   "event === 'PASSWORD_RECOVERY'" in client,
                   "client.ts must branch on the PASSWORD_RECOVERY event"))

    checks.append(("G2 client stashes recovery + dispatches event (not login)",
                   ("borderpay_password_recovery" in client
                    and "borderpay_recovery_token" in client
                    and "borderpay:password_recovery" in client),
                   "must stash recovery token/flag + dispatch recovery event"))

    checks.append(("G3 client exports recovery helpers",
                   all(f"export function {fn}" in client
                       for fn in ("isPasswordRecovery", "getRecoveryToken", "clearPasswordRecovery")),
                   "must export isPasswordRecovery/getRecoveryToken/clearPasswordRecovery"))

    checks.append(("G4 useAuth: recovery is not treated as login",
                   ("isPasswordRecovery" in useauth and "!isPasswordRecovery()" in useauth),
                   "isAuthenticated must be gated with !isPasswordRecovery()"))

    checks.append(("G5 App routes recovery → reset-password",
                   ("isPasswordRecovery" in app
                    and "|| isPasswordRecovery()" in app
                    and "borderpay:password_recovery" in app),
                   "App must detect recovery (flag + event) and set reset state"))

    checks.append(("G6 ResetPasswordScreen uses recovery store + clears on exit",
                   ("getRecoveryToken()" in rps and "clearPasswordRecovery" in rps),
                   "reset screen must read getRecoveryToken() and clear recovery"))

    sw_ok = ("borderpay-app-v2.11.0" not in sw) and ("borderpay-app-v2.12.0" in sw)
    checks.append(("G7 service-worker cache bumped off v2.11.0", sw_ok,
                   "CACHE_NAME/RUNTIME_CACHE must be bumped (v2.12.0)"))

    print("password_recovery_routing_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

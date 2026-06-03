#!/usr/bin/env python3
"""
"Lock app" (biometric quick-return) audit.

"Lock app" is a LOCAL-only sign-out that preserves a refreshable session behind
WebAuthn so the user can re-enter via Face/Touch ID. It is DISTINCT from
"Log out", which revokes the session server-side and clears everything. This audit
locks the security contract so the two can't drift into each other.

Invariants (fail closed):

  (L1) lockApp() is LOCAL-only: uses signOut({ scope: 'local' }) (does NOT revoke
       server-side), sets the lock marker, removes only borderpay_token, and does
       NOT clear borderpay_user / borderpay_refresh_token (biometric needs them).
  (L2) the SIGNED_OUT handler preserves the profile during a lock
       (clearUserProfile guarded by !isAppLocked()).
  (L3) useAuth AND AppContext treat locked as NOT authenticated (every computed
       isAuthenticated includes !isAppLocked()); AppContext skips hydration.
  (L4) App.tsx routes a locked app to the login screen (before the authed route).
  (L5) REGRESSION GUARD — full Log out (useAuth.signOut) still clears
       token+user+refresh AND calls a GLOBAL supabase.auth.signOut() (NOT
       scope:'local'), i.e. it still revokes server-side.
  (L6) explicit password login clears the lock marker (clearAppLocked) before
       signing in, so a stale lock can't block credential auth.
  (L7) the UI exposes "Lock app" beside the logout surfaces (AppShell drawer +
       Settings), not Settings-only.
  (L8) the lock gate helpers are exported from client.ts.
  (L9) a LOCKED cancel/timeout preserves the lock + session for retry
       (keepLockForRetry: keep refresh/user/lock, drop only the access token).
  (L10) a hard failure (or not locked) still tears down to password.

Non-runtime: parses source as text. No deploy, no DB, no network.

Run: python3 tests/audit/app_lock_audit.py   (exit 0 = pass)
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT     = Path(__file__).resolve().parents[2]
CLIENT   = ROOT / "utils" / "supabase" / "client.ts"
USEAUTH  = ROOT / "utils" / "auth" / "useAuth.ts"
APPCTX   = ROOT / "utils" / "app" / "AppContext.tsx"
APP      = ROOT / "App.tsx"
LOGIN    = ROOT / "components" / "auth" / "LoginScreen.tsx"
SHELL    = ROOT / "components" / "shell" / "AppShell.tsx"
SETTINGS = ROOT / "components" / "settings" / "SettingsScreen.tsx"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def sl(s: str, start: str, end: str) -> str:
    i = s.find(start)
    if i < 0:
        return ""
    j = s.find(end, i + len(start))
    return s[i:j] if j > i else s[i:]


def main() -> int:
    client   = read(CLIENT)
    useauth  = read(USEAUTH)
    appctx   = read(APPCTX)
    app      = read(APP)
    login    = read(LOGIN)
    shell    = read(SHELL)
    settings = read(SETTINGS)

    checks: list[tuple[str, bool, str]] = []

    # L1 — lockApp is local-only and preserves the prerequisites
    lock_fn = sl(client, "lockApp: async () =>", "getToken:")
    l1 = (bool(lock_fn)
          and "signOut({ scope: 'local' })" in lock_fn
          and "setAppLocked()" in lock_fn
          and "removeItem('borderpay_token')" in lock_fn
          and "removeItem('borderpay_refresh_token')" not in lock_fn
          and "removeItem('borderpay_user')" not in lock_fn
          and "clearUserProfile" not in lock_fn)
    checks.append(("L1 lockApp local-only + preserves session prerequisites", l1,
                   "lockApp must use signOut({scope:'local'}), setAppLocked, remove only borderpay_token, keep user+refresh"))

    # L2 — SIGNED_OUT preserves profile during a lock
    so = sl(client, "if (event === 'SIGNED_OUT') {", "} else if")
    l2 = ("if (!isAppLocked()) {" in so and "clearUserProfile()" in so)
    checks.append(("L2 SIGNED_OUT keeps profile during lock", l2,
                   "SIGNED_OUT branch must guard clearUserProfile() with !isAppLocked()"))

    # L3 — useAuth + AppContext gate on isAppLocked
    ua = [c for c in re.findall(r"isAuthenticated:\s*[^\n,]*", useauth) if "!!" in c]
    ac = [c for c in re.findall(r"isAuthenticated:\s*[^\n,]*", appctx) if "!!" in c]
    l3 = (len(ua) >= 2 and all("isAppLocked()" in c for c in ua)
          and len(ac) >= 2 and all("isAppLocked()" in c for c in ac)
          and "if (isAppLocked())" in appctx)
    checks.append(("L3 useAuth+AppContext treat locked as not authenticated", l3,
                   f"every isAuthenticated calc must include !isAppLocked() + AppContext reload early-return. ua={ua} ac={ac}"))

    # L4 — App.tsx routes locked -> login, before the authed route
    rf = sl(app, "const determineRoute = async () =>", "\n    };")
    g = rf.find("if (isAppLocked())")
    r = rf.find("if (isAuthenticated && user)")
    l4 = (g >= 0 and r >= 0 and g < r and "setAppState('login')" in rf[g:r])
    checks.append(("L4 App.tsx routes locked -> login", l4,
                   "determineRoute must handle isAppLocked() (route to login) before the authenticated route"))

    # L5 — full Log out still revokes server-side (regression guard)
    so_fn = sl(useauth, "const signOut = useCallback(async () =>", "}, []);")
    l5 = (bool(so_fn)
          and "removeItem('borderpay_token')" in so_fn
          and "removeItem('borderpay_user')" in so_fn
          and "removeItem('borderpay_refresh_token')" in so_fn
          and "supabase.auth.signOut()" in so_fn
          and "scope: 'local'" not in so_fn)
    checks.append(("L5 Log out still full-clears + global revoke", l5,
                   "useAuth.signOut must clear token+user+refresh and call GLOBAL supabase.auth.signOut() (not scope:'local')"))

    # L6 — password login clears the lock marker before signing in
    login_fn = sl(login, "const handleLogin = async (e: React.FormEvent) =>", "\n  };")
    i_clear = login_fn.find("clearAppLocked(")
    i_signin = login_fn.find("signInWithPassword(")
    l6 = (i_clear >= 0 and i_signin >= 0 and i_clear < i_signin)
    checks.append(("L6 password login clears lock before sign-in", l6,
                   "handleLogin must clearAppLocked() before signInWithPassword()"))

    # L7 — Lock app shown beside logout in AppShell drawer AND Settings
    l7 = (("onLock" in shell and "Lock app" in shell)
          and ("onLock" in settings and "'lock'" in settings))
    checks.append(("L7 Lock app beside logout in shell + settings", l7,
                   "AppShell drawer and SettingsScreen must both expose a Lock app action beside logout"))

    # L8 — gate helpers exported
    l8 = all(f"export function {fn}" in client
             for fn in ("isAppLocked", "setAppLocked", "clearAppLocked"))
    checks.append(("L8 lock gate helpers exported", l8,
                   "client.ts must export isAppLocked/setAppLocked/clearAppLocked"))

    # L9 — locked + cancel/timeout preserves the lock + session (soft retry path)
    keep = sl(login, "const keepLockForRetry = () =>", "\n  };")
    handler = sl(login, "const handleBiometricLogin = async () =>", "\n  };")
    l9 = (bool(keep)
          and "removeItem('borderpay_token')" in keep
          and "removeItem('borderpay_refresh_token')" not in keep
          and "removeItem('borderpay_user')" not in keep
          and "signOut" not in keep
          and "clearAppLocked" not in keep
          and "isAppLocked() && isCancelOrTimeout(" in handler
          and "keepLockForRetry()" in handler)
    checks.append(("L9 locked cancel preserves lock + session (retry)", l9,
                   "a locked cancel/timeout must call keepLockForRetry() (keep refresh/user/lock, drop only access token), not clearRestoredSession"))

    # L10 — hard failure (or not locked) still tears down to password
    fail_branch = sl(handler, "if (!result.success)", "// Step 6")
    l10 = ("await clearRestoredSession();" in fail_branch
           and "isCancelOrTimeout(msg)" in fail_branch)
    checks.append(("L10 hard failure still tears down", l10,
                   "the failure branch must still clearRestoredSession() for hard failures / not-locked"))

    print("app_lock_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

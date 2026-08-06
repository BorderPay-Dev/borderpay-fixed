from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REQUEST = (ROOT / 'supabase/functions/auth-request-pin-reset/index.ts').read_text()
CONFIRM = (ROOT / 'supabase/functions/auth-confirm-pin-reset/index.ts').read_text()
APP = (ROOT / 'App.tsx').read_text()
SCREEN = (ROOT / 'components/auth/ResetPinScreen.tsx').read_text()
CONFIG = (ROOT / 'supabase/config.toml').read_text()

failures = []
if '/auth/pin-reset?token=' not in REQUEST:
    failures.append('reset email does not target the app PIN reset callback')
if 'if (!emailResponse.ok)' not in REQUEST:
    failures.append('reset request hides email delivery failures')
if 'pin_reset_tokens' not in REQUEST or 'pin_reset_tokens' not in CONFIRM:
    failures.append('reset request/confirm do not share one-time token storage')
if "window.location.pathname === '/auth/pin-reset'" not in APP:
    failures.append('app does not recognize the PIN reset callback route')
if "appState === 'reset-pin'" not in APP:
    failures.append('auth router does not preserve the PIN reset screen')
if 'user_id: row.user_id' not in CONFIRM:
    failures.append('reset confirmation does not identify the obsolete device PIN cache')
if 'borderpay_security_${resetUserId}' not in SCREEN or 'clearAppLocked()' not in SCREEN:
    failures.append('reset completion does not retire the obsolete local PIN and app lock')
if "const isPinValid = /^\\d{6}$/.test(newPin)" not in SCREEN or "if (!/^\\d{6}$/.test(newPin))" not in CONFIRM:
    failures.append('reset PIN length differs between client and server')
if '[functions.auth-request-pin-reset]' not in CONFIG or '[functions.auth-confirm-pin-reset]' not in CONFIG:
    failures.append('public recovery endpoints are not pinned in function config')

if failures:
    print('pin_reset_recovery_audit: FAIL')
    for failure in failures:
        print(f' - {failure}')
    raise SystemExit(1)

print('pin_reset_recovery_audit: PASS')

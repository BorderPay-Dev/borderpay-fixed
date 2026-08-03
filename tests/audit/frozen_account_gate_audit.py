from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


main = read("components/app/MainApp.tsx")
profile = read("supabase/functions/get-user-profile/index.ts")
worker = read("supabase/functions/process-pending-events/index.ts")
guard = read("supabase/functions/_shared/account-access.ts")

require("'Account frozen'" in main, "Frozen-only screen is missing")
require("access !== 'active'" in main, "Features must not mount before access is verified")
require("<UnlockedMainApp {...props} />" in main, "Unlocked application must mount only after an active result")
require("account_status:      profile?.account_status || null" in profile, "Profile payload must expose canonical account_status")
require('update.account_status = "frozen"' in worker, "Bridge restriction webhook must set canonical frozen state")
require('code: "account_frozen"' in guard, "Server guard must return the stable frozen-account code")
require("if (error || !data)" in guard, "Server guard must fail closed when status cannot be read")

for endpoint in (
    "bridge-transfer",
    "bridge-bulk-payout",
    "bridge-external-account",
    "bridge-virtual-account",
    "external-wallet",
):
    source = read(f"supabase/functions/{endpoint}/index.ts")
    require("requireActiveAccount" in source, f"{endpoint} must enforce the shared account guard")
    call = "const accountAccess = await requireActiveAccount(supa, user.id);"
    require(call in source, f"{endpoint} must call the shared account guard after authentication")
    require(source.index(call) > source.index("supa.auth.getUser(token)"), f"{endpoint} guard must run after authentication")

print("frozen account gate audit: PASS")

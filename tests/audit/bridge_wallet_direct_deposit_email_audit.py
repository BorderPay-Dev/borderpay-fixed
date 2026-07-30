from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
process = (ROOT / "supabase/functions/process-pending-events/index.ts").read_text()

failures: list[str] = []

def require(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)

require("async function emailWalletActivityBestEffort" in process,
        "process-pending-events must have a wallet activity email sender.")
require('"individual.transaction_notification"' in process and '"business.transaction_notification"' in process,
        "wallet activity emails must use the Money in/out transaction notification templates.")
require("const isDirectWalletDeposit =" in process,
        "wallet activity handler must explicitly identify direct crypto deposits.")
require('["direct_deposit", "deposit"].includes(walletActivityType)' in process,
        "direct wallet deposit detection must include Bridge direct_deposit payloads.")
require('paymentRouteType !== "virtual_account_event"' in process,
        "direct wallet deposit email must exclude VA settlement wallet activity to prevent duplicate VA emails.")
require("if (isDirectWalletDeposit)" in process,
        "wallet activity email must only send for direct wallet deposits.")
require("wh:wallet-activity:" in process,
        "wallet activity emails must be idempotent by Bridge activity/transfer id.")
require("new_balance: params.newBalance" in process,
        "wallet activity email props must include the Bridge available balance when present.")

if failures:
    print("bridge_wallet_direct_deposit_email_audit: FAIL")
    for failure in failures:
        print(f"- {failure}")
    raise SystemExit(1)

print("bridge_wallet_direct_deposit_email_audit: PASS")

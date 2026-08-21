#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


worker = read("supabase/functions/process-pending-events/index.ts")
guard = read("supabase/functions/_shared/account-access.ts")
profile = read("supabase/functions/get-user-profile/index.ts")
migration = read("supabase/migrations/20260804223000_bridge_account_paused_at.sql")

require('update.account_status = "frozen"' in worker, "Bridge restrictions must set the canonical freeze")
require("previousProfileError" in worker, "previous Bridge status lookup must capture errors")
require("previous status lookup failed" in worker, "previous status lookup must fail closed")
require("bridge customer profile not found" in worker, "unknown Bridge customers must not be silently accepted")
require("profileUpdateError" in worker and "status update failed" in worker, "freeze persistence errors must fail closed")
require('accountStatus === "paused" && previousAccountStatus !== "paused"' in worker, "pause email must be transition-only")
require("wh:account-paused:${bridgeCustomerId}:${pausedAt}" in worker, "pause email must be idempotent")
require('"business.account_suspended"' in worker and '"individual.account_suspended"' in worker, "both account templates are required")
require("bridge_account_status,bridge_account_paused_at" in guard, "server guard must read Bridge pause state")
require("if (error || !data)" in guard, "server guard must fail closed when state is unavailable")
require('"paused"' in guard and 'code: "account_frozen"' in guard, "Bridge pause must return the stable frozen code")
require("bridge_account_paused_at" in profile, "profile response must expose the pause timestamp")
require("add column if not exists bridge_account_paused_at timestamptz" in migration, "pause timestamp needs an authoritative migration")

for endpoint in (
    "bridge-transfer",
    "bridge-bulk-payout",
    "bridge-external-account",
    "bridge-virtual-account",
    "bridge-wallet",
    "bridge-provision-stablecoins",
    "external-wallet",
    "yellowcard-sandbox-transaction",
):
    source = read(f"supabase/functions/{endpoint}/index.ts")
    require("getFinancialAccessBlock" in source, f"{endpoint} must enforce the shared account guard")
    call = "await getFinancialAccessBlock("
    call_at = source.find(call)
    require(call_at >= 0, f"{endpoint} must invoke the shared account guard")
    auth_at = max(source.rfind("auth.getUser", 0, call_at), source.rfind("authenticateAfricanRailsTester", 0, call_at))
    require(auth_at >= 0 and auth_at < call_at, f"{endpoint} guard must run after authentication")

print("paused account gate audit: PASS")

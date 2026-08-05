#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text()


status = read("utils/bridgeAccountStatus.ts")
screen = read("components/account/PausedAccountScreen.tsx")
main = read("components/app/MainApp.tsx")
worker = read("supabase/functions/process-pending-events/index.ts")
profile = read("supabase/functions/get-user-profile/index.ts")

assert "=== 'paused'" in status
assert "rejected" not in status
assert "This account exceeds our present risk tolerance" in screen
assert "If we are able to unfreeze this account" in screen
assert "isBridgeAccountPaused(u)" in main
assert "<PausedAccountScreen" in main
assert 'accountStatus === "paused"' in worker
assert "bridge_account_paused_at" in worker
assert "bridge_account_paused_at" in profile

print("paused account gate audit passed")

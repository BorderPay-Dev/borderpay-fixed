#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
va = (ROOT / "supabase/functions/bridge-virtual-account/index.ts").read_text()
profile = (ROOT / "supabase/functions/get-user-profile/index.ts").read_text()
client = (ROOT / "utils/bridgeAccountStatus.ts").read_text()

checks = {
    "VA endpoint recognizes frozen and offboarded states": all(value in va for value in ('"frozen"', '"offboarded"', '"suspended"')),
    "VA endpoint loads both canonical status fields": '.select("account_status,bridge_account_status")' in va,
    "VA endpoint fails closed if status cannot be read": 'code: "account_status_unavailable"' in va and '}, 503)' in va,
    "VA endpoint returns a frozen denial": 'code: "account_frozen"' in va and '}, 423)' in va,
    "status guard precedes Bridge traffic": va.index('const { data: accessProfile') < va.index('logControlledBridgeTraffic("bridge-virtual-account"'),
    "profile response exposes local freeze evidence": all(value in profile for value in ('account_status:', 'account_frozen_at:', 'account_frozen_reason:')),
    "released-client compatibility maps blocks to paused": 'bridge_account_status: accountAccessRestricted ? "paused"' in profile,
    "future clients evaluate local and provider states": 'profile?.account_status' in client and 'profile?.bridge_account_status' in client and 'BLOCKED_ACCOUNT_STATUSES' in client,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit(f"{len(failed)} frozen-account checks failed")
print(f"PASS: {len(checks)}/{len(checks)} frozen-account checks")

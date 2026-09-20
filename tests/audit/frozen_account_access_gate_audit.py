#!/usr/bin/env python3
import re
from pathlib import Path
from va_audit_source import audited_source

ROOT = Path(__file__).resolve().parents[2]
va = audited_source(ROOT / "supabase/functions/bridge-virtual-account/index.ts")
profile = (ROOT / "supabase/functions/get-user-profile/index.ts").read_text()
client = (ROOT / "utils/bridgeAccountStatus.ts").read_text()

boundary = (ROOT / "supabase/functions/_shared/predeposit-http-boundary.ts").read_text()

checks = {
    "VA endpoint recognizes frozen and offboarded states": all(value in va for value in ('"frozen"', '"offboarded"', '"suspended"')),
    "VA endpoint loads both canonical status fields": '.select("account_status,bridge_account_status")' in va,
    "VA endpoint fails closed if status cannot be read": 'if(accessProfileError||!accessProfile)throw Error("Account access status unavailable")' in va and 'catch{return unavailable();}' in boundary and 'status:503' in boundary,
    "VA endpoint returns a frozen denial": 'code:"account_frozen"' in va and 'status:423' in va,
    "status guard precedes capabilities and Bridge traffic": bool(re.search(r"const\s*\{\s*data:\s*accessProfile", va)) and boundary.index("await deps.checkAccess(userId)") < boundary.index("const response=await deps.handle(req)") and va.index('if (action === "capabilities")') < va.index('logControlledBridgeTraffic("bridge-virtual-account"'),
    "profile response exposes local freeze evidence": all(value in profile for value in ('account_status:', 'account_frozen_at:', 'account_frozen_reason:')),
    "released-client compatibility maps blocks to paused":
        'const clientBridgeAccountStatus = accountAccessRestricted' in profile
        and '? "paused"' in profile
        and 'bridge_account_status: clientBridgeAccountStatus' in profile,
    "future clients evaluate local and provider states": 'profile?.account_status' in client and 'profile?.bridge_account_status' in client and 'BLOCKED_ACCOUNT_STATUSES' in client,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit(f"{len(failed)} frozen-account checks failed")
print(f"PASS: {len(checks)}/{len(checks)} frozen-account checks")

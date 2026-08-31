#!/usr/bin/env python3
"""Fail releases if non-EEA users depend on Bridge SCA availability."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "supabase/functions/_shared/bridge-sca-scope.ts").read_text()
MAIN_APP = (ROOT / "components/app/MainApp.tsx").read_text()
SEND = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
ACTION_HOOK = (ROOT / "utils/security/useBridgeScaAction.tsx").read_text()

required = {
    "local scope resolver": "export function resolveLocalBridgeScaScope",
    "verified non-EEA bypass": "if (country && !BRIDGE_EEA_SCA_COUNTRIES.has(country))",
    "non-EEA decision": 'status: "not_required", reason: "non_eea"',
    "provider lookup after local decision": "if (localDecision) return localDecision;",
}

missing = [label for label, needle in required.items() if needle not in SOURCE]
if missing:
    raise SystemExit("non_eea_sca_scope_audit: FAIL: " + ", ".join(missing))

local_return = SOURCE.index("if (localDecision) return localDecision;")
provider_call = SOURCE.index("bridgeProvider.getCustomerProfile(customerId)")
if local_return > provider_call:
    raise SystemExit("non_eea_sca_scope_audit: FAIL: provider lookup precedes local bypass")

if "const bridgeScaUiEnabled = !isNativeRuntime();" not in MAIN_APP:
    raise SystemExit("non_eea_sca_scope_audit: FAIL: native account-access SCA is not disabled")
if "const protectedAccountAccess = bridgeScaUiEnabled &&" not in MAIN_APP:
    raise SystemExit("non_eea_sca_scope_audit: FAIL: native financial screens can still be gated")
if "if (isNativeRuntime())" not in SEND:
    raise SystemExit("non_eea_sca_scope_audit: FAIL: native send flow can still request SCA")
if "if (isNativeRuntime()) return '';" not in ACTION_HOOK:
    raise SystemExit("non_eea_sca_scope_audit: FAIL: native sensitive actions can still request SCA")

print("non_eea_sca_scope_audit: PASS")

#!/usr/bin/env python3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text()


provider = read("supabase/functions/_shared/providers/bridge.ts")
endpoint = read("supabase/functions/bridge-virtual-account/index.ts")
types = read("supabase/functions/_shared/providers/types.ts")
activation_copy = read("utils/virtualAccountActivationCopy.ts")

failures: list[str] = []

if "/virtual_accounts/${encodeURIComponent(virtualAccountId)}/reactivate" not in provider:
    failures.append("provider must call Bridge's virtual-account reactivation endpoint")
if "borderpay:va-reactivate:${customerId}:${virtualAccountId}" not in provider:
    failures.append("reactivation must use a deterministic idempotency key")
if 'originalBridgeStatus === "deactivated"' not in endpoint:
    failures.append("deactivated Bridge accounts must be detected")
if "sameCurrencyBridgeAccounts.find" not in endpoint or '["active", "activated"].includes' not in endpoint:
    failures.append("an active provider account must win over an obsolete duplicate")
if "bridgeProvider.reactivateVirtualAccount" not in endpoint:
    failures.append("a deactivated account must be reactivated instead of recreated")
if 'code: wasReactivated ? "virtual_account_reactivated"' not in endpoint:
    failures.append("successful reactivation must be explicit in the API response")
if 'status:                    "active"' in endpoint:
    failures.append("create responses must not be persisted as active unconditionally")
if "result.status ?? raw.status" not in endpoint or "status?:            string" not in types:
    failures.append("the provider activation status must flow through persistence")
if "feePercentNumber >= 100" not in provider or "n >= 100" not in endpoint:
    failures.append("Bridge's exclusive 100% developer-fee maximum must be enforced")
if "source:      { currency: input.currency.toLowerCase() }" not in provider:
    failures.append("VA source currency must use Bridge's lowercase schema enum")
if "destinationBridgeWalletId" not in provider or "bridge_wallet_id: destinationBridgeWalletId" not in provider:
    failures.append("Bridge-owned VA destinations must use the canonical bridge_wallet_id")
if "destination.bridge_wallet_id || destination.address" not in endpoint:
    failures.append("VA idempotency must identify the canonical Bridge wallet destination")
if "bridge_validation_details: bridgeValidationDetails(e.raw_text)" not in endpoint:
    failures.append("provider validation failures must retain Bridge's field-level details")
if 'currency === "USD" && providerCode === "invalid_parameters"' not in endpoint:
    failures.append("the live Bridge USD incident must be contained without customer retry prompts")
if '"provider_usd_unavailable"' not in endpoint or 'code: "va_provider_pending"' not in endpoint:
    failures.append("USD provider outages must be recorded and returned as pending")
if "provider_testing_va_limit" not in endpoint or "exceeds limit of testing virtual account numbers" not in endpoint:
    failures.append("Bridge's testing VA quota must be classified explicitly")
if "usdLimitIncident" in endpoint or "Support will activate it for you; no further action is required" in endpoint:
    failures.append("the retired USD provider quota circuit must not block operational requests")
if "providerUnavailableCurrencies" in endpoint or "effectiveSetupPendingCurrencies" not in endpoint:
    failures.append("retired provider outages must not suppress operational capabilities")
if "code === 'va_provider_pending'" not in activation_copy:
    failures.append("the client must render provider-pending as informational, not as an error")

if failures:
    raise SystemExit("\n".join(f"FAIL: {failure}" for failure in failures))

print("bridge VA reactivation audit passed")

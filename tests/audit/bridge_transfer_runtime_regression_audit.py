#!/usr/bin/env python3
"""Fail if bridge-transfer regresses billing, Bridge payload, or freeze guards."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "supabase/functions/bridge-transfer/index.ts").read_text()
PROVIDER = (ROOT / "supabase/functions/_shared/providers/bridge.ts").read_text()
SCA = (ROOT / "supabase/functions/_shared/sca.ts").read_text()
SCOPE = (ROOT / "supabase/functions/_shared/bridge-sca-scope.ts").read_text()

checks = {
    "legacy maintenance block removed": (
        "maintenance_due" not in SOURCE and "maintenance_overdue" not in SOURCE
    ),
    "Bridge destination chain stripped": (
        'filter(([key]) => key !== "chain")' in SOURCE
        and "chain:        transferChain" not in SOURCE
    ),
    "frozen-account guard preserved": (
        "getFinancialAccessBlock" in SOURCE and "if (accessBlock)" in SOURCE
    ),
    "transfer consumes request-bound SCA authorization": (
        "consumeScaAuthorization" in SOURCE
        and 'resource: "bridge_transfer"' in SOURCE
        and "request: scaAuthorizedRequest" in SOURCE
    ),
    "SCA hashes the client request before provider-only mutation": (
        "const scaAuthorizedRequest = structuredClone(body)" in SOURCE
        and SOURCE.find("const scaAuthorizedRequest = structuredClone(body)")
        < SOURCE.find("body.destination = {")
    ),
    "SCA is consumed before provider execution": (
        SOURCE.find("const sca = await consumeScaAuthorization")
        < SOURCE.find("const result = await bridgeProvider.createTransfer")
    ),
    "provider receives SCA only when required": (
        "...(sca.required ?" in SOURCE and "sca_attestation" in SOURCE
    ),
    "provider serializes Bridge initiation attestation": (
        "initiation:" in PROVIDER
        and "attestations: { sca:" in PROVIDER
        and "input.sca_attestation.outcome" in PROVIDER
    ),
    "non-EEA transfers bypass SCA": (
        'scope.status === "not_required"' in SCA
        and "required: false" in SCA
    ),
    "business scope uses incorporation data": (
        'accountType === "business"' in SCOPE
        and "country_of_incorporation" in SCOPE
        and "registeredAddress.country" in SCOPE
    ),
    "business scope falls back only to stored incorporation country": (
        "normalizeBridgeScaCountry(identity.context.country)" in SCOPE
        and "operating_address" not in SCOPE
    ),
    "missing business incorporation country fails closed": (
        'status: "unknown"' in SCOPE
        and 'reason: identity.context.account_type === "business"' in SCOPE
        and '"business_incorporation_country_unavailable"' in SCOPE
    ),
    "UK and Switzerland excluded from EEA scope": (
        '"GB"' not in SCOPE.split("const EEA_ISO3_TO_ISO2", 1)[0]
        and '"CH"' not in SCOPE.split("const EEA_ISO3_TO_ISO2", 1)[0]
    ),
    "EEA scope contains exactly 30 countries": (
        len(set(__import__("re").findall(r'"([A-Z]{2})"', SCOPE.split("const EEA_ISO3_TO_ISO2", 1)[0]))) == 30
    ),
    "SCA requires approved identity": (
        'verificationStatus === "approved"' in SCOPE
    ),
    "SCA requires active custodial wallet": (
        "isActiveBridgeCustodialWallet" in SCOPE
        and 'reason: "no_custodial_wallet"' in SCOPE
    ),
    "transfer stores queryable SCA evidence": (
        "sca_required: sca.required" in SOURCE
        and 'sca_attestation_outcome: sca.required ? "sca_used" : null' in SOURCE
        and "sca_authorization_id:" in SOURCE
    ),
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("bridge_transfer_runtime_regression_audit: FAIL\n- " + "\n- ".join(failed))

print("bridge_transfer_runtime_regression_audit: PASS")

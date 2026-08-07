#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def require(path: str, fragments: list[str]) -> None:
    text = (ROOT / path).read_text()
    missing = [fragment for fragment in fragments if fragment not in text]
    if missing:
        raise SystemExit(f"{path}: missing regression contract: {missing}")


require(
    "supabase/functions/yellowcard-sandbox-transaction/index.ts",
    [
        'SANDBOX_SUCCESS_EVM_ADDRESS = "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe"',
        'SANDBOX_SUCCESS_TRON_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"',
        'const digits = outcome === "success" ? "1111111111" : "0000000000"',
        'return `+${dialCode}${digits}`',
        'accountNumber: sandboxAccount(context.country, context.channel, sandboxOutcome)',
        'sandbox_simulated: true',
        'expected_outcome: sandboxOutcome',
    ],
)

transaction = (ROOT / "supabase/functions/yellowcard-sandbox-transaction/index.ts").read_text()
if 'walletAddress: str(wallet.address)' in transaction:
    raise SystemExit("real Bridge wallet address must not be sent to Yellow Card sandbox")

require(
    "utils/africanRailsPolicyCache.ts",
    [
        "const CACHE_VERSION = 'v3'",
        "const CACHE_TTL_MS = 5 * 60 * 1000",
        "backendAPI.payouts.yellowCardCapabilities('corridor_policy'",
        "if (provider !== 'yellow_card') return",
    ],
)

require(
    "components/send/SendMoneyFlow.tsx",
    [
        "const amountToValidate = isAfricanPayout ? Number(africanQuote?.destinationAmount) : sourceAmount",
        "validateTransferAmount(amountToValidate",
        "if (active && !cacheIsFresh) setAfricanPolicyRows([])",
    ],
)

print("yellowcard sandbox outcome regression audit passed")

#!/usr/bin/env python3
"""P0 gate: EURC received on Base must remain withdrawable on Base."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


send = read("components/send/SendMoneyFlow.tsx")
fields = read("components/payouts/ExternalCryptoWithdrawalFields.tsx")
wallets = read("components/wallets/ExternalWalletsScreen.tsx")
api = read("utils/api/backendAPI.ts")
external = read("supabase/functions/external-wallet/index.ts")
validator = read("supabase/functions/_shared/bridge-payout-validator.ts")
transfer = read("supabase/functions/bridge-transfer/index.ts")

checks = {
    "EURC is a typed customer withdrawal token": "'USDT' | 'USDC' | 'EURC'" in fields,
    "Base exposes EURC": "tokens: ['USDC', 'EURC']" in fields,
    "saved destinations expose EURC/Base": "'EURC:base'" in wallets,
    "send selector exposes EURC/Base": "{ token: 'EURC', network: 'base'" in send,
    "Base route normalization preserves EURC": "n === 'base' && t === 'EURC'" in send,
    "client transport accepts EURC": "'usdc' | 'usdt' | 'eurc'" in api,
    "destination API accepts EURC": 'new Set(["USDC", "EURC", "USDT"])' in external,
    "provider validator permits EURC/Base": '"BASE:EURC"' in validator,
    "cross-token conversion stays blocked": 'code: "currency_mismatch"' in validator,
    "saved Base address works for USDC and EURC": 'savedAsset === "USDC" || savedAsset === "EURC"' in transfer,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("EURC external withdrawal audit failed: " + ", ".join(failed))

print(f"EURC external withdrawal audit passed ({len(checks)}/{len(checks)})")

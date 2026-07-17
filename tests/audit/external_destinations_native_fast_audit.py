#!/usr/bin/env python3
"""
Regression guard for payout destination screens.

Live policy:
- Withdrawal wallets exposed in the customer UI are only USDC/Base and USDT/Tron.
- Fiat payout destination list/add screens must first-paint immediately from
  cache/default options and refresh in the background. No blocking skeleton gate.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    path = ROOT / rel
    if not path.is_file():
        raise AssertionError(f"missing file: {rel}")
    return path.read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    wallets = read("components/wallets/ExternalWalletsScreen.tsx")
    accounts = read("components/payouts/ExternalAccountsScreen.tsx")
    add_account = read("components/payouts/AddExternalAccountScreen.tsx")

    require("WITHDRAWAL_ROUTES" in wallets, "Withdrawal wallet routes must be explicit")
    require("'USDC:base'" in wallets and "'USDT:tron'" in wallets, "Only USDC/Base and USDT/Tron routes may be exposed")
    for forbidden in ["ethereum", "polygon", "arbitrum", "optimism", "solana"]:
        require(forbidden not in wallets.lower(), f"Unsupported withdrawal route leaked: {forbidden}")
    require("filterSupportedWallets" in wallets, "External wallet rows must be filtered before rendering/cache")
    require("SkeletonRows" not in wallets and "const [loading" not in wallets and "setLoading(false)" not in wallets, "Withdrawal wallets must not block first paint")

    require("navPerfTrackCache('external-accounts'" in accounts, "External accounts must emit cache hit/miss telemetry")
    require("SkeletonRows" not in accounts and "const [loading" not in accounts and "setLoading(false)" not in accounts, "External account list must not block first paint")
    require("no setLoading(true) here" in accounts, "External account background refresh invariant comment missing")

    require("DEFAULT_ACCOUNT_TYPES" in add_account, "Add payout account must have immediate default account types")
    require("SkeletonRows" not in add_account and "capabilityLoading" not in add_account, "Add payout account must not block on capabilities")

    print("external_destinations_native_fast_audit: PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print("external_destinations_native_fast_audit: FAIL", file=sys.stderr)
        print(f" - {exc}", file=sys.stderr)
        raise SystemExit(1)

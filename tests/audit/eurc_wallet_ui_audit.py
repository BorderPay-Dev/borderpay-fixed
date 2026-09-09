#!/usr/bin/env python3
"""Keep the automatic EEA EURC wallet visible without adding a manual request CTA."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

wallet = (ROOT / "components/wallet/WalletScreen.tsx").read_text(encoding="utf-8")
add_wallet = (ROOT / "components/wallet/AddWalletScreen.tsx").read_text(encoding="utf-8")
visuals = (ROOT / "components/dashboard/bridge/WalletVisuals.tsx").read_text(encoding="utf-8")
main = (ROOT / "components/app/MainApp.tsx").read_text(encoding="utf-8")

assert "new Set(['USDC', 'USDT', 'EURC'])" in wallet, "Wallet screen filters out EURC"
assert "stablecoinFiatSymbol(sym)" in wallet, "EURC balance lacks euro display"
assert "EURC:" in visuals, "EURC visual metadata is missing"
assert "{ code: 'EURC', type: 'stablecoin'" not in add_wallet, "EURC must not become a manual wallet request"

protected = main[main.index("const BRIDGE_SCA_ACCOUNT_ACCESS_SCREENS"):main.index("const SHELL_TO_SCREEN")]
assert "'wallet-detail'" in protected, "Wallet details are not SCA protected"
assert "'receive-money'" not in protected, "Fund-in/Receive must remain outside Bridge SCA"

print("EURC wallet UI audit passed")

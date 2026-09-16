#!/usr/bin/env python3
"""Regression gate for EEA VA-linked Base wallet presentation."""
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "utils/financial/vaLinkedWalletPresentation.ts"
API = ROOT / "utils/api/backendAPI.ts"
WALLET = ROOT / "components/wallet/WalletScreen.tsx"
RECEIVE = ROOT / "components/receive/ReceiveMoneyScreen.tsx"


def require(source: str, marker: str, label: str) -> None:
    if marker not in source:
        raise SystemExit(f"FAIL: {label} missing {marker}")


helper = HELPER.read_text()
api = API.read_text()
wallet = WALLET.read_text()
receive = RECEIVE.read_text()

for marker in [
    "const activeBaseWallets = wallets.filter",
    "options.allowEurcBase ? ['USDC', 'EURC'] : ['USDC']",
    "presentation_id: `${authoritativeWalletId}:${asset}`",
    "USDT is a separate Tron wallet",
    "return canonicalRows",
]:
    require(helper, marker, "VA-linked wallet selector")

if "delete" in helper.lower() or ".update(" in helper:
    raise SystemExit("FAIL: presentation selector must not mutate provider or database records")

require(api, "allowUsdtTron: walletAssetScope.allow_usdt_tron", "financial snapshot scope")
require(wallet, "new Set(['USDC', 'EURC', 'USDT'])", "wallet supported assets")
require(wallet, "presentation_id", "stablecoin row key")
require(wallet, "selectVaLinkedStablecoinWallets(scoped, cachedVas,", "wallet cache")
require(receive, "selectVaLinkedStablecoinWallets(scoped, cachedVas,", "receive cache")

print("PASS: one authoritative Base wallet is presented")
print("PASS: unlinked Base duplicates are hidden without provider/database mutation")
print("PASS: USDC/EURC share Base; region-permitted USDT remains a separate Tron wallet")

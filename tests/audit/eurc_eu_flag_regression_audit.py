#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
visuals = (ROOT / "components/dashboard/bridge/WalletVisuals.tsx").read_text()
dashboard = (ROOT / "components/app/Dashboard.tsx").read_text()
add_wallet = (ROOT / "components/wallet/AddWalletScreen.tsx").read_text()

checks = {
    "shared EURC badge resolves to EUR flag": "sym === 'EURC' ? 'EUR' : sym" in visuals,
    "shared badge renders normalized flag": "<FiatFlag symbol={flagSymbol} />" in visuals,
    "dashboard EURC chip uses EU flag": "EURC: '🇪🇺'" in dashboard,
    "add-wallet uses shared asset badge": '<AssetBadge symbol={card.code} size={44} />' in add_wallet,
    "add-wallet has no EURC remote-icon override": "const STABLE_ICON_URL" not in add_wallet,
    "wallet boundary permits EURC": "const SUPPORTED_STABLES = new Set(['USDC', 'EURC'])" in (ROOT / "components/wallet/WalletScreen.tsx").read_text(),
    "dashboard boundary permits only USDC and EURC": "if (!['USDC', 'EURC'].includes" in dashboard,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit(f"EURC EU flag regression audit failed: {', '.join(failed)}")
print(f"EURC EU flag regression audit passed ({len(checks)}/{len(checks)})")

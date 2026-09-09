#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")

worker = read("supabase/functions/process-pending-events/index.ts")
bulk = read("supabase/functions/bridge-provision-stablecoins/index.ts")
wallet = read("supabase/functions/bridge-wallet/index.ts")
va = read("supabase/functions/bridge-virtual-account/index.ts")
destination = read("supabase/functions/_shared/providers/virtual-account-config.ts")
screen = read("components/wallet/AddWalletScreen.tsx")
main = read("components/app/MainApp.tsx")

checks = {
    "EEA webhook auto-provision disabled": 'bridge_eea_wallet_auto_provision_skipped' in worker,
    "EEA bulk auto-provision disabled": bulk.count('eea_manual_wallet_activation_required') >= 2,
    "country wallet pair enforced": 'wallet_asset_not_available_for_country' in wallet,
    "wallet endpoint requires pilot": 'bridgeEeaPilotEmailAllowed(user.email)' in wallet,
    "VA endpoint requires pilot": 'bridgeEeaPilotEmailAllowed(user.email)' in va,
    "VA requires Base wallet": 'eea_wallet_activation_required' in va and '.ilike("chain", "base")' in va,
    "EUR EEA VA settles to EURC": 'currency === "EUR" ? "EURC" : "USDC"' in destination,
    "EEA UI exposes EURC": "{ code: 'EURC', type: 'stablecoin'" in screen,
    "EEA UI hides Tron": "card.code === 'USDC' || card.code === 'EURC'" in screen,
    "locked mobile state": "pilot_access_locked" in main and "EEA account activation required" in main,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items(): print(f"[{'OK' if passed else 'FAIL'}] {name}")
if failed: raise SystemExit("eea_manual_wallet_before_va_audit: FAIL")
print(f"eea_manual_wallet_before_va_audit: PASS ({len(checks)}/{len(checks)})")

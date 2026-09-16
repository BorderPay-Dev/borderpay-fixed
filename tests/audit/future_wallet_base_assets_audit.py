#!/usr/bin/env python3
"""Keep automatic provisioning regional: EEA Base-only, non-EEA adds Tron."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROVISION = (ROOT / "supabase/functions/bridge-provision-stablecoins/index.ts").read_text(encoding="utf-8")
EVENTS = (ROOT / "supabase/functions/process-pending-events/index.ts").read_text(encoding="utf-8")


checks = {
    "automatic provisioner creates one Base wallet": 'const DEFAULT_WALLET = { symbol: "USDC", chain: "BASE" }' in PROVISION,
    "automatic provisioner presents USDC and EURC": 'const customerAssets = walletScope.allow_eurc_base ? ["USDC", "EURC"] : ["USDC"]' in PROVISION,
    "automatic provisioner gates Tron to non-EEA": 'chain: "TRON"' in PROVISION and 'walletScope.allow_usdt_tron' in PROVISION,
    "approval webhook creates one Base wallet": 'const DEFAULT_STABLECOIN_WALLET = { symbol: "USDC", chain: "BASE" }' in EVENTS,
    "approval webhook keeps Base default and gates Tron": 'DEFAULT_STABLECOIN_WALLET = { symbol: "USDT"' not in EVENTS and 'walletScope.allow_usdt_tron' in EVENTS,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("future_wallet_base_assets_audit: FAIL\n- " + "\n- ".join(failed))

print(f"future_wallet_base_assets_audit: PASS ({len(checks)}/{len(checks)})")

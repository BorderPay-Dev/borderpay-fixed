#!/usr/bin/env python3
"""Block future automatic provisioning from reintroducing Tron for customers."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROVISION = (ROOT / "supabase/functions/bridge-provision-stablecoins/index.ts").read_text(encoding="utf-8")
EVENTS = (ROOT / "supabase/functions/process-pending-events/index.ts").read_text(encoding="utf-8")


checks = {
    "manual provisioner creates one Base wallet": 'const DEFAULT_WALLET = { symbol: "USDC", chain: "BASE" }' in PROVISION,
    "manual provisioner presents USDC and EURC": 'const CUSTOMER_ASSETS = ["USDC", "EURC"]' in PROVISION,
    "manual provisioner has no Tron default": 'chain: "TRON"' not in PROVISION,
    "approval webhook creates one Base wallet": 'const DEFAULT_STABLECOIN_WALLET = { symbol: "USDC", chain: "BASE" }' in EVENTS,
    "approval webhook has no Tron default": 'DEFAULT_STABLECOIN_WALLET = { symbol: "USDT"' not in EVENTS,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("future_wallet_base_assets_audit: FAIL\n- " + "\n- ".join(failed))

print(f"future_wallet_base_assets_audit: PASS ({len(checks)}/{len(checks)})")

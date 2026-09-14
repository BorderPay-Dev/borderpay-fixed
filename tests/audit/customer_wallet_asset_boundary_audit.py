#!/usr/bin/env python3
"""P0 gate: customer wallet surfaces may fetch only USDC/EURC on Base."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
read = lambda path: (ROOT / path).read_text(encoding="utf-8")

backend = read("utils/api/backendAPI.ts")
presentation = read("utils/financial/vaLinkedWalletPresentation.ts")
wallet = read("components/wallet/WalletScreen.tsx")
add_wallet = read("components/wallet/AddWalletScreen.tsx")
receive = read("components/receive/ReceiveMoneyScreen.tsx")
external = read("components/wallets/ExternalWalletsScreen.tsx")
withdrawal = read("components/payouts/ExternalCryptoWithdrawalFields.tsx")
provision = read("supabase/functions/bridge-provision-stablecoins/index.ts")
wallet_fn = read("supabase/functions/bridge-wallet/index.ts")
provider = read("supabase/functions/_shared/providers/bridge.ts")
migration = read("supabase/migrations/20260914170000_customer_wallet_assets_base_only.sql")

checks = {
    "customer wallet queries constrain Base": backend.count(".ilike('chain', 'base')") >= 3,
    "customer wallet queries constrain assets": backend.count(".in('currency', ['USDC', 'EURC'])") >= 3,
    "presentation emits only Base assets": "const displayAssets = ['USDC', 'EURC']" in presentation and "return canonicalRows" in presentation,
    "wallet screen supports only USDC/EURC": "new Set(['USDC', 'EURC'])" in wallet,
    "add-wallet contains EURC and no USDT card": "{ code: 'EURC'" in add_wallet and "{ code: 'USDT'" not in add_wallet,
    "receive exposes only USDC/EURC": "return ['USDC', 'EURC']" in receive and "String(wallet.currency).toUpperCase() === 'USDT'" not in receive,
    "saved payout wallets expose only USDC Base": "USDC:base" in external and "USDT:tron" not in external,
    "withdrawal selector exposes no Tron route": "id: 'tron'" not in withdrawal,
    "provisioning creates one Base chain wallet": "const DEFAULT_WALLET = { symbol: \"USDC\", chain: \"BASE\" }" in provision,
    "manual wallet endpoint is Base-only": 'const SYMS:   readonly StablecoinSymbol[] = ["USDC", "EURC"]' in wallet_fn and 'const CHAINS: readonly StablecoinChain[]  = ["BASE"]' in wallet_fn,
    "provider create payload is chain-only": "const body = { chain: input.chain.toLowerCase() };" in provider and "currency: input.symbol.toLowerCase()" not in provider,
    "database owner reads hide Tron/USDT": "lower(coalesce(chain, '')) = 'base'" in migration and "in ('USDC', 'EURC')" in migration,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("customer_wallet_asset_boundary_audit: FAIL\n- " + "\n- ".join(failed))

print(f"customer_wallet_asset_boundary_audit: PASS ({len(checks)}/{len(checks)})")

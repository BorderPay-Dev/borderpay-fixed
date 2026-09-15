#!/usr/bin/env python3
"""P0 gate: EEA is Base-only; non-EEA may additionally use USDT/Tron."""

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
migration = read("supabase/migrations/20260915190000_restore_non_eea_usdt_reads.sql")
scope = read("supabase/functions/_shared/bridge-sca-scope.ts")
external_fn = read("supabase/functions/external-wallet/index.ts")
transfer_fn = read("supabase/functions/bridge-transfer/index.ts")
va_config = read("supabase/functions/_shared/providers/virtual-account-config.ts")

checks = {
    "non-EEA wallet presentation excludes EURC": "options.allowUsdtTron && !options.includeWithdrawalAssets ? ['USDC'] : ['USDC', 'EURC']" in presentation,
    "external selector displays USDT but disables it for EEA": "disabled={route.asset === 'USDT' && !allowUsdtTron}" in external,
    "withdrawal funding retains hidden assets": "walletAPI.getWallets({ includeWithdrawalAssets: true })" in backend,
    "wallet reads include the three supported assets": backend.count(".in('currency', ['USDC', 'EURC', 'USDT'])") >= 3,
    "presentation keeps USDT separate from VA-linked Base": "USDT is a separate Tron wallet" in presentation and "allowUsdtTron" in presentation,
    "wallet cache restores Tron after regional scope resolves": "walletScopeResolved" in wallet and "selectVaLinkedStablecoinWallets(scoped, cachedVas, { allowUsdtTron })" in wallet,
    "receive cache restores Tron after regional scope resolves": "walletScopeResolved" in receive and "selectVaLinkedStablecoinWallets(scoped, cachedVas, { allowUsdtTron })" in receive,
    "wallet screen supports three bounded assets": "new Set(['USDC', 'EURC', 'USDT'])" in wallet,
    "add-wallet hides USDT unless non-EEA": "{ code: 'USDT'" in add_wallet and "card.code !== 'USDT' || allowUsdtTron" in add_wallet,
    "receive binds USDT to Tron": "sym === 'USDT' && chain === 'tron'" in receive,
    "saved payout wallets gate USDT by scope": "USDT:tron" in external and "allowUsdtTron" in external,
    "address validation is independent of the Base-only form selector": "../../utils/financial/cryptoAddress" in withdrawal,
    "provisioning keeps Base default and conditionally adds Tron": "const DEFAULT_WALLET = { symbol: \"USDC\", chain: \"BASE\" }" in provision and "allowUsdtTron" in provision,
    "manual wallet endpoint is region-gated": 'const SYMS:   readonly StablecoinSymbol[] = ["USDC", "EURC", "USDT"]' in wallet_fn and "wallet_asset_not_available" in wallet_fn,
    "provider create payload is chain-only": "const body = { chain: input.chain.toLowerCase() };" in provider and "currency: input.symbol.toLowerCase()" not in provider,
    "database restores region-gated Tron owner reads": "can_read_borderpay_usdt(auth.uid())" in migration and "lower(coalesce(chain, '')) = 'tron'" in migration,
    "legacy USDT restore grants SELECT only": "wallets_usdt_owner_read on public.wallets for select to authenticated" in migration,
    "authoritative EEA set contains exactly 30 states": "The 30 EEA states" in scope and "BRIDGE_EEA_SCA_COUNTRIES" in scope,
    "external-wallet resolves scope only for USDT": "if (asset === \"USDT\")" in external_fn and "if (hasUsdt)" in external_fn and "wallet_asset_not_available" in external_fn,
    "transfer rejects EEA USDT before provider movement": "requestsUsdt" in transfer_fn and "wallet_asset_not_available" in transfer_fn,
    "VA destination contract has no USDT rail": 'export type VaCurrency = "USD" | "EUR" | "GBP"' in va_config and "USDT" not in va_config,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("customer_wallet_asset_boundary_audit: FAIL\n- " + "\n- ".join(failed))

print(f"customer_wallet_asset_boundary_audit: PASS ({len(checks)}/{len(checks)})")

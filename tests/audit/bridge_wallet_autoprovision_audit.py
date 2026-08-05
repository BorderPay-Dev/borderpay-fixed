#!/usr/bin/env python3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text()


provider = read("supabase/functions/_shared/providers/bridge.ts")
worker = read("supabase/functions/process-pending-events/index.ts")
provisioner = read("supabase/functions/bridge-provision-stablecoins/index.ts")
wallet_endpoint = read("supabase/functions/bridge-wallet/index.ts")

create_wallet = provider.split("async createWallet", 1)[1].split("// ── Money movement", 1)[0]
worker_provision = worker.split("async function ensureStablecoinWalletsProvisioned", 1)[1].split(
    "async function syncCountryFromBridgeCustomer", 1
)[0]

failures: list[str] = []

if "currency: input.symbol" in create_wallet:
    failures.append("Bridge CreateBridgeWallet must not send the removed currency field")
if "chain: input.chain.toLowerCase()" not in create_wallet:
    failures.append("Bridge CreateBridgeWallet must send the canonical lowercase chain")
if "response missing id/address" not in create_wallet or "this.listWallets" not in create_wallet:
    failures.append("wallet creation must reconcile addressless idempotent responses from Bridge")
if "r.status === 409 || r.status === 422" not in create_wallet:
    failures.append("wallet creation must reconcile Bridge same-chain conflicts")

for expected in ['{ symbol: "USDC", chain: "BASE" }', '{ symbol: "USDT", chain: "TRON" }']:
    if expected not in worker or expected not in provisioner:
        failures.append(f"missing auto-provision default {expected}")

if 'if (normalized === "approved")' not in worker or "ensureStablecoinWalletsProvisioned" not in worker:
    failures.append("approved KYC/KYB events must invoke stablecoin auto-provisioning")
if '.from("wallets")' in worker_provision:
    failures.append("stablecoin provisioning must not write the fiat-only legacy wallets table")
if "bridgeWalletErr" not in worker_provision:
    failures.append("webhook provisioning must fail and retry when bridge_wallets persistence fails")

if '.from("bridge_wallets")' not in wallet_endpoint:
    failures.append("bridge-wallet idempotency must read the canonical bridge_wallets table")
if '.from("wallets")' in wallet_endpoint:
    failures.append("bridge-wallet must not write stablecoins into the fiat-only wallets table")

if failures:
    raise SystemExit("\n".join(f"FAIL: {failure}" for failure in failures))

print("bridge wallet auto-provision audit passed")

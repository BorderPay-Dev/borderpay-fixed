#!/usr/bin/env python3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text()


provider = read("supabase/functions/_shared/providers/bridge.ts")
country_policy = read("supabase/functions/_shared/providers/bridge-country-policy.ts")
worker = read("supabase/functions/process-pending-events/index.ts")
provisioner = read("supabase/functions/bridge-provision-stablecoins/index.ts")
wallet_endpoint = read("supabase/functions/bridge-wallet/index.ts")
config = read("supabase/config.toml")

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

for symbol, chain in [("EURC", "BASE"), ("USDC", "BASE"), ("USDT", "TRON")]:
    if not __import__("re").search(rf'symbol:\s*"{symbol}"\s*,\s*chain:\s*"{chain}"', country_policy, flags=__import__("re").DOTALL):
        failures.append(f"missing authoritative wallet policy {symbol}/{chain}")

if "bridgeAutomaticWalletsForCountry(country)" not in worker_provision:
    failures.append("webhook provisioning must select wallets from the authoritative country policy")
if provisioner.count("bridgeAutomaticWalletsForCountry(profile.country)") != 2:
    failures.append("both user and operator provisioner paths must select wallets from authoritative country")
if "DEFAULT_STABLECOIN_WALLETS" in worker or "const DEFAULTS" in provisioner:
    failures.append("provisioning must not retain country-blind wallet defaults")
if "isGatewayVerifiedServiceRoleJwt(token)" not in provisioner:
    failures.append("operator provisioning must accept only the gateway-verified service-role JWT during key rotation")
if 'payload.role === "service_role"' not in provisioner or "payload.ref === projectRef" not in provisioner:
    failures.append("legacy service-role authorization must bind both role and project ref")
provisioner_config = config.split("[functions.bridge-provision-stablecoins]", 1)[1].split("[functions.", 1)[0]
if "verify_jwt = true" not in provisioner_config:
    failures.append("service-role claim authorization requires fail-closed gateway JWT verification")

eu_match = __import__("re").search(
    r"BRIDGE_EU_COUNTRIES[^=]*=\s*new\s+Set\s*\(\s*\[([^\]]*)\]",
    country_policy,
    flags=__import__("re").DOTALL,
)
expected_eu = {
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI",
    "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU",
    "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
}
if not eu_match:
    failures.append("missing explicit EU-27 country set")
else:
    actual_eu = set(__import__("re").findall(r'"([A-Z]{2})"', eu_match.group(1)))
    if actual_eu != expected_eu:
        failures.append(f"EU wallet policy must use exactly EU-27; got {sorted(actual_eu)}")
    for excluded in ("GB", "NO", "IS", "LI", "CH"):
        if excluded in actual_eu:
            failures.append(f"non-EU country {excluded} must not receive the EU wallet policy")

if 'if (normalized === "approved")' not in worker or "ensureStablecoinWalletsProvisioned" not in worker:
    failures.append("approved non-EEA KYC/KYB events must invoke stablecoin auto-provisioning")
if 'if (isBridgeEeaCountry(country))' not in worker_provision or 'bridge_eea_wallet_auto_provision_skipped' not in worker_provision:
    failures.append("EEA approval webhooks must defer wallet creation to an explicit user request")
if provisioner.count('eea_manual_wallet_activation_required') < 2:
    failures.append("both user and operator bulk provisioner paths must leave EEA wallets manual")
if '.from("wallets")' in worker_provision:
    failures.append("stablecoin provisioning must not write the fiat-only legacy wallets table")
if "bridgeWalletErr" not in worker_provision:
    failures.append("webhook provisioning must fail and retry when bridge_wallets persistence fails")
if "existingLookupError" not in worker_provision:
    failures.append("webhook provisioning must fail closed when canonical wallet lookup fails")
if 'lock.state === "busy"' not in worker_provision or "wallet provisioning already in progress" not in worker_provision:
    failures.append("an in-flight wallet lock must retry the KYB event instead of silently completing it")
if 'status === "processing"' not in worker or 'takeover = takeover.lte("received_at", staleIso)' not in worker:
    failures.append("only an actively processing lock may be subject to the stale-lock delay")
if "describeWalletProvisioningError" not in worker_provision:
    failures.append("Bridge wallet failures must retain provider code/message/request id for operations")

country_sync = worker.split("async function syncCountryFromBridgeCustomer", 1)[1].split(
    "async function resolveOwnerFromBridgeCustomer", 1
)[0]
if "hasBridgeCountryMismatch" not in country_sync:
    failures.append("Bridge country sync must detect stale non-empty profile countries")
if "userCountry !== bridgeCountry" not in country_sync:
    failures.append("Bridge country sync must correct a stale user country")
if "businessCountry !== bridgeCountry" not in country_sync:
    failures.append("Bridge country sync must correct a stale business country")
if 'value.raw_text ? `response=${String(value.raw_text).slice(0, 240)}`' not in worker_provision:
    failures.append("Bridge wallet invalid-parameter diagnostics must retain a bounded provider response")
if worker_provision.find('.from("bridge_wallets")') > worker_provision.find("tryAcquireProvisioningLock("):
    failures.append("canonical wallet state must be checked before acquiring/reopening a provisioning lock")

if '.from("bridge_wallets")' not in wallet_endpoint:
    failures.append("bridge-wallet idempotency must read the canonical bridge_wallets table")
if '.from("wallets")' in wallet_endpoint:
    failures.append("bridge-wallet must not write stablecoins into the fiat-only wallets table")

if failures:
    raise SystemExit("\n".join(f"FAIL: {failure}" for failure in failures))

print("bridge wallet auto-provision audit passed")

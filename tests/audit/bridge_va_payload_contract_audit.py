from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
endpoint = (ROOT / "supabase/functions/bridge-virtual-account/index.ts").read_text()
config = (ROOT / "supabase/functions/_shared/providers/virtual-account-config.ts").read_text()
provider = (ROOT / "supabase/functions/_shared/providers/bridge.ts").read_text()

checks = {
    "USD/EUR/GBP use Base": 'const rail = "base";' in config,
    "USD/EUR/GBP use USDC": 'const ccy = "USDC";' in config,
    "external wallet fallback removed": '.from("external_wallets")' not in config,
    "static destination fallback removed": 'source: "static_config"' not in config,
    "Bridge wallet id is mandatory": 'if (!destinationBridgeWalletId || !destinationRail || !input.destination?.currency)' in provider,
    "provider sends Bridge wallet id": 'bridge_wallet_id: destinationBridgeWalletId' in provider,
    "provider does not send destination address": '{ address: destinationAddress }' not in provider,
    "USD direct VA fee is 3%": 'USD: "3"' in endpoint,
    "EUR direct VA fee is 2.98%": 'EUR: "2.98"' in endpoint,
    "GBP direct VA fee is 2.98%": 'GBP: "2.98"' in endpoint,
    "currency selects the fee": 'DIRECT_VA_DEVELOPER_FEE_PERCENT[currency as "USD" | "EUR" | "GBP"]' in endpoint,
    "account type does not select the fee": 'BUSINESS_VA_DEVELOPER_FEE_PERCENT' not in endpoint and 'INDIVIDUAL_VA_DEVELOPER_FEE_PERCENT' not in endpoint,
    "old USD incident gate removed": 'usdLimitIncident' not in endpoint,
    "old provider incident does not suppress capability": 'providerUnavailableCurrencies' not in endpoint,
    "source currency remains request currency": 'source:      { currency: input.currency.toLowerCase() }' in provider,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("Bridge VA payload contract audit failed: " + "; ".join(failed))

print(f"Bridge VA payload contract audit passed ({len(checks)}/{len(checks)})")

#!/usr/bin/env python3
"""
Bridge product-truth cleanup audit.

Locks the UI/server contract that BorderPay only exposes products Bridge can
actually support for the user's country and our current backend scope:

  P1. Country-policy helpers exist in both frontend and server policy files.
  P2. The helper encodes the current Bridge docs examples:
      Kenya => no USD VA but EUR/GBP VA; Angola => USD/EUR/GBP; Kenya
      custodial wallets remain supported; Australia/Singapore/etc. do not.
  P3. Bridge VA and wallet cards use those helpers, not static all-country
      product lists.
  P4. The provisioning modal uses those helpers before selection/submission.
  P5. Edge functions enforce the same country/product gates before provider
      calls, including business-profile country/KYB lookup.
  P6. Fake live routes are not mounted: add-money/deposit go to the Bridge
      receive surface; converter goes to the guarded exchange surface.
  P7. Country eligibility replaces card-restrictions framing, and cards are
      locked without mock card previews.

Usage:
  $ python3 tests/audit/bridge_product_truth_cleanup_audit.py
"""
from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def check(name: str, ok: bool, detail: str) -> tuple[str, bool, str]:
    return (name, ok, detail)


def has_all(src: str, needles: list[str]) -> bool:
    return all(n in src for n in needles)


def extract_set(src: str, name: str) -> set[str]:
    m = re.search(
        rf"{re.escape(name)}[^=]*=\s*new\s+Set\s*\(\s*\[([^\]]*)\]",
        src,
        re.DOTALL,
    )
    if not m:
        return set()
    return set(re.findall(r"['\"]([A-Z]{2})['\"]", m.group(1)))


def main() -> int:
    frontend_policy = read("utils/compliance/partnerCountryPolicy.ts")
    server_policy = read("supabase/functions/_shared/providers/bridge-country-policy.ts")
    va_card = read("components/dashboard/bridge/BridgeVirtualAccountsCard.tsx")
    wallet_card = read("components/dashboard/bridge/BridgeWalletsCard.tsx")
    modal = read("components/wallet/RequestProvisioningModal.tsx")
    business_dashboard = read("components/business/BusinessDashboard.tsx")
    settings = read("components/settings/SettingsScreen.tsx")
    country_screen = read("components/compliance/CountryEligibilityScreen.tsx")
    cards_screen = read("components/cards/CardsScreen.tsx")
    cards_card = read("components/dashboard/bridge/CardsLockedCard.tsx")
    backend_api = read("utils/api/backendAPI.ts")
    va_fn = read("supabase/functions/bridge-virtual-account/index.ts")
    wallet_fn = read("supabase/functions/bridge-wallet/index.ts")
    main_app = read("components/app/MainApp.tsx")
    funding = read("components/deposit/FundingScreen.tsx")

    checks: list[tuple[str, bool, str]] = []

    helper_needles = [
        "bridgeVirtualAccountCurrenciesForCountry",
        "isBridgeVirtualAccountCurrencyAvailable",
        "isBridgeCustodialWalletSupported",
        "BRIDGE_VA_NO_US_RAIL",
        "BRIDGE_VA_NO_SEPA_FPS_RAIL",
        "BRIDGE_CUSTODIAL_WALLET_UNSUPPORTED_COUNTRIES",
        "https://apidocs.bridge.xyz/platform/customers/compliance/supported-countries-list",
    ]
    checks.append(check(
        "P1 helper contract exists in frontend and server policy",
        has_all(frontend_policy, helper_needles) and has_all(server_policy, helper_needles),
        "country/product helpers must be mirrored for UI and edge functions",
    ))

    checks.append(check(
        "P2 docs-backed country examples encoded",
        "KE" in extract_set(frontend_policy, "BRIDGE_VA_NO_US_RAIL")
        and "KE" not in extract_set(frontend_policy, "BRIDGE_VA_NO_SEPA_FPS_RAIL")
        and "KE" not in extract_set(frontend_policy, "BRIDGE_CUSTODIAL_WALLET_UNSUPPORTED_COUNTRIES")
        and "GW" in extract_set(frontend_policy, "BRIDGE_CUSTODIAL_WALLET_UNSUPPORTED_COUNTRIES")
        and "AO" not in extract_set(frontend_policy, "BRIDGE_VA_NO_US_RAIL")
        and "AO" not in extract_set(frontend_policy, "BRIDGE_VA_NO_SEPA_FPS_RAIL")
        and "AU" in extract_set(frontend_policy, "BRIDGE_CUSTODIAL_WALLET_UNSUPPORTED_COUNTRIES")
        and "SG" in extract_set(frontend_policy, "BRIDGE_CUSTODIAL_WALLET_UNSUPPORTED_COUNTRIES")
        and "VN" in extract_set(frontend_policy, "BRIDGE_CUSTODIAL_WALLET_UNSUPPORTED_COUNTRIES")
        and extract_set(frontend_policy, "BRIDGE_VA_NO_US_RAIL") == extract_set(server_policy, "BRIDGE_VA_NO_US_RAIL")
        and extract_set(frontend_policy, "BRIDGE_VA_NO_SEPA_FPS_RAIL") == extract_set(server_policy, "BRIDGE_VA_NO_SEPA_FPS_RAIL")
        and extract_set(frontend_policy, "BRIDGE_CUSTODIAL_WALLET_UNSUPPORTED_COUNTRIES") == extract_set(server_policy, "BRIDGE_CUSTODIAL_WALLET_UNSUPPORTED_COUNTRIES"),
        "Kenya must lose USD VA only, not custodial wallets; Angola remains supported for current VA currencies",
    ))

    checks.append(check(
        "P3 dashboard Bridge cards use country helpers",
        has_all(va_card, [
            "bridgeVirtualAccountCurrenciesForCountry",
            "isBridgeVirtualAccountCurrencyAvailable",
            ".select('bridge_kyb_status, country')",
            ".select('bridge_kyc_status, country')",
            "availableCurrencies.filter",
        ])
        and "const ALL_CURRENCIES" not in va_card
        and has_all(wallet_card, [
            "isBridgeCustodialWalletSupported",
            ".select('bridge_kyb_status, country')",
            ".select('bridge_kyc_status, country')",
            "walletsSupported",
            "Stablecoin wallets are not available for your country.",
        ]),
        "cards must derive availability from country, not show every product everywhere",
    ))

    checks.append(check(
        "P4 provisioning modal gates products before selection and submit",
        has_all(modal, [
            "bridgeVirtualAccountCurrenciesForCountry",
            "isBridgeCustodialWalletSupported",
            "isBridgeVirtualAccountCurrencyAvailable",
            "availableVaCurrencies.length === 0",
            "stablecoinSupported",
            "backendAPI.business.getProfile",
            "availableVaCurrencies.map",
        ])
        and "(['USD', 'EUR', 'GBP'] as const).map" not in modal,
        "modal must not offer static USD/EUR/GBP or wallets without country support",
    ))

    checks.append(check(
        "P5 edge functions enforce product gates and business country/KYB",
        has_all(va_fn, [
            "isBridgeVirtualAccountCurrencyAvailable",
            "country_rail_not_supported",
            ".from(\"business_profiles\")",
            ".select(\"country, bridge_kyb_status\")",
            "verificationStatus",
            "KYB not approved yet",
        ])
        and has_all(wallet_fn, [
            "isBridgeCustodialWalletSupported",
            "wallet_country_not_supported",
            ".from(\"business_profiles\")",
            ".select(\"country, bridge_kyb_status\")",
            "verificationStatus",
            "KYB not approved yet",
        ]),
        "server must block unsupported country/product combinations before Bridge API calls",
    ))

    checks.append(check(
        "P6 fake live routes removed from mounted app paths",
        "const CurrencyConverter" not in main_app
        # The legacy mock funding screen (mobile-money / card mocks) must never
        # be mounted. The live funding route now mounts the self-contained
        # FundingScreen, which composes the SAME truthful Bridge surfaces.
        and "const AddMoneyScreen" not in main_app
        and "AddMoneyScreen" not in main_app
        and re.search(r"case 'converter':\s*return <ExchangeScreen", main_app)
        and re.search(r"case 'deposit':\s*case 'add-money':\s*return <FundingScreen", main_app)
        # FundingScreen must be the real Bridge surface (provisioned VA +
        # stablecoin), not a mock: no fabricated mobile-money / card flows.
        and "BridgeVirtualAccountsCard" in funding
        and "BridgeWalletsCard" in funding
        and "mobileMoney" not in funding
        and "MTN" not in funding
        and "USD, EUR, GBP, or stablecoin" not in business_dashboard,
        "interactive mock converter/deposit screens must not be mounted as live routes",
    ))

    checks.append(check(
        "P7 cards are locked and country eligibility is not card restrictions",
        "CountryEligibilityScreen" in main_app
        and "country-eligibility" in main_app
        and "card-restrictions" not in main_app
        and "CardRestrictionsScreen" not in main_app
        and "Country availability" in settings
        and "Restricted countries" in settings
        and "cards.geoRestrictions" not in settings
        and "Country eligibility" in country_screen
        and "Cards are locked" in cards_screen
        and "No card can be issued yet" in cards_screen
        and "Card access locked" in cards_card
        and "cards_locked" in backend_api
        and "cards_coming_soon" not in backend_api
        and "gradient:" not in cards_screen
        and "Virtual cards, soon" not in cards_screen,
        "cards must be a locked product boundary; country eligibility must not be framed as card restrictions",
    ))

    failures = [c for c in checks if not c[1]]
    for name, ok, detail in checks:
        print(f"{'PASS' if ok else 'FAIL'}: {name} — {detail}")
    if failures:
        return 1
    print("PASS: bridge product-truth cleanup audit")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

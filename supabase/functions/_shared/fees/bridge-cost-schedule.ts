/**
 * RAW PROVIDER COST SCHEDULE — server-side only, NEVER exposed to the UI.
 *
 * This is our underlying provider's wholesale price list (what BorderPay is
 * charged). It is the COST basis the customer-facing fee engine builds on. It
 * is intentionally NOT imported by any frontend module and the provider is
 * never named to users — see utils/fees/schedule.ts for the customer-facing
 * (white-labeled) fees we actually display/charge.
 *
 * Figures are the provider's published schedule, verbatim:
 *   Basic orchestration ............ 0.25% of amount
 *   Virtual-account orchestration .. 0.50% of amount
 *   Virtual account (USD/GBP/EUR) .. $2.00 per active or created account (annual/maintenance)
 *   Virtual account (MXN) .......... $1.50
 *   Virtual account (BRL/COP) ...... $1.80
 *   Identity: KYC .................. $2.00 per user (annual)
 *   Identity: KYB .................. $10.00 per business (annual)
 *   USDT support ................... 0.10% of amount
 *   FX (EUR/GBP/MXN) .............. mid-market + 0.50%
 *   FX (BRL) ...................... mid-market + 0.55%
 *   FX (COP) ...................... mid-market + 0.75%
 *   USDB support .................. 0.25% AUM
 *   Wallets ....................... $0.25 per active or created wallet
 *   Third-party fees .............. passed through AT COST
 */

/** Percentages are expressed as PERCENT (0.25 == 0.25%). USD amounts in dollars. */
export const PROVIDER_COST = {
  orchestration: {
    basic_percent:           0.25,
    virtual_account_percent: 0.50,
  },
  /** Per active-or-created virtual account, charged monthly (maintenance). */
  virtual_account_usd: {
    USD: 2.00, GBP: 2.00, EUR: 2.00,
    MXN: 1.50,
    BRL: 1.80, COP: 1.80,
  } as Record<string, number>,
  identity_usd: {
    kyc: 2.00,   // per user, annual
    kyb: 10.00,  // per business, annual
  },
  usdt_support_percent: 0.10,
  /** FX spread added to mid-market, by quote currency (percent). */
  fx_spread_percent: {
    EUR: 0.50, GBP: 0.50, MXN: 0.50,
    BRL: 0.55,
    COP: 0.75,
  } as Record<string, number>,
  usdb_aum_percent: 0.25,
  wallet_usd:       0.25,   // per active or created stablecoin wallet
  /** Third-party network/banking fees are passed through with NO markup. */
  third_party: "pass_through_at_cost" as const,
} as const;

/** Monthly maintenance cost for an active virtual account in `currency`
 *  (defaults to USD pricing). Used by the wallet-balance maintenance debit. */
export function virtualAccountMonthlyCostUsd(currency: string | null | undefined): number {
  const c = String(currency ?? "USD").toUpperCase();
  return PROVIDER_COST.virtual_account_usd[c] ?? PROVIDER_COST.virtual_account_usd.USD;
}

/** One-time onboarding identity cost we must clear from the activation fee. */
export function onboardingIdentityCostUsd(accountType: string | null | undefined): number {
  return String(accountType ?? "").toLowerCase() === "business"
    ? PROVIDER_COST.identity_usd.kyb
    : PROVIDER_COST.identity_usd.kyc;
}

/** Per-wallet provider cost for active/created stablecoin wallets. */
export function walletCostUsd(): number {
  return PROVIDER_COST.wallet_usd;
}

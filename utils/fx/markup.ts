/**
 * Platform FX markup.
 *
 * Applied on top of our banking partner's published rate to produce the
 * customer-facing quote. This single constant is the source of truth — UI
 * widgets (DashboardRateWidget, ExchangeScreen) and any future server
 * quote endpoint should import it instead of hard-coding a value.
 *
 * Current rate: 1.5% (0.015). The previous 2% rate is retired.
 *
 * If the markup ever needs to vary by corridor (e.g. African corridors at
 * 0.5%, EUR at 1.5%), introduce a tiered table here — do NOT scatter
 * different multipliers across components.
 */

export const PARTNER_FX_MARKUP = 0.015;

/** Apply the markup to a partner mid-rate. Returns the customer-facing rate. */
export function withMarkup(midRate: number): number {
  return midRate * (1 + PARTNER_FX_MARKUP);
}

/** Display string for the markup — used in disclaimers/tooltips. */
export function markupLabel(): string {
  return `${(PARTNER_FX_MARKUP * 100).toFixed(1)}%`;
}

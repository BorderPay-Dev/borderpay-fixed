/**
 * Platform FX markup.
 *
 * Applied on top of the provider-published rate to produce the
 * customer-facing quote. This single constant is the source of truth — UI
 * widgets (DashboardRateWidget, ExchangeScreen) and any future server
 * quote endpoint should import it instead of hard-coding a value.
 *
 * ON HOLD (0%): the previous 1.5% generic fiat FX markup is suspended for
 * transparency — we show users the real partner mid-rate with no hidden
 * spread. (Earlier rates: 2% → 1.5% → 0%.) Our only disclosed markup is the
 * per-plan African payout markup below, which is an explicit BorderPay fee on
 * the local-currency leg, not a hidden FX spread.
 *
 * To re-enable a generic spread later, set this back to a non-zero fraction;
 * every consumer reads it (and `markupLabel()`), so nothing else changes.
 */

export const PARTNER_FX_MARKUP = 0;

/** Apply the markup to a partner mid-rate. Returns the customer-facing rate. */
export function withMarkup(midRate: number): number {
  return midRate * (1 + PARTNER_FX_MARKUP);
}

/** Display string for the markup — used in disclaimers/tooltips. */
export function markupLabel(): string {
  return `${(PARTNER_FX_MARKUP * 100).toFixed(1)}%`;
}

// ── African payout markup (tiered by plan) ──────────────────────────────────
// African-currency payouts use BorderPay's fixed per-plan markup instead of the
// flat PARTNER_FX_MARKUP. The canonical numbers live in utils/fees/schedule.ts
// (mirrored from the edge module); we re-expose them here as a 0..1 fraction so
// FX widgets keep a single import surface for "the markup to apply".
import { africanPayoutMarkupPercent } from '../fees/schedule';

/** Customer-facing African payout markup as a fraction (e.g. 0.01 for 1%). */
export function africanPayoutMarkup(planKey: string | null | undefined): number {
  return africanPayoutMarkupPercent(planKey) / 100;
}

/** Apply the plan's African payout markup to a partner mid-rate. */
export function withAfricanPayoutMarkup(midRate: number, planKey: string | null | undefined): number {
  return midRate * (1 + africanPayoutMarkup(planKey));
}

/** Display string for an African payout markup, e.g. "1.0%" / "0.5%". */
export function africanPayoutMarkupLabel(planKey: string | null | undefined): string {
  return `${africanPayoutMarkupPercent(planKey).toFixed(1)}%`;
}

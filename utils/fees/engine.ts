/**
 * Strategic revenue fee engine (#B3).
 *
 * Computes the customer-facing payout fee for the checkout screen, by corridor.
 * The PROVIDER is white-labeled (no provider name in any label), but the total
 * fee the customer pays IS disclosed — labels are neutral/BorderPay-branded.
 *
 * Tiers (exact figures):
 *   International (US / EU / LatAm — routed through the international payout API):
 *     0.35% orchestration + 0.999% fixed settlement + 2.5% BorderPay developer
 *     markup, for BOTH individual and business. Third-party/network costs are
 *     passed through AT COST (absolute, added on top).
 *   African (routed through the localized aggregator):
 *     raw local settlement (pass-through) cost + BorderPay markup of
 *     0.75% (individual) / 0.50% (business).
 */

import { BRIDGE_DEVELOPER_FEE_PERCENT, africanPayoutMarkupPercentForAccount } from './schedule';

export type Corridor    = 'international' | 'african';
export type FeeAccount  = 'individual' | 'business';

/** International stack components (percent). */
export const INTL_ORCHESTRATION_PERCENT   = 0.35;
export const INTL_FIXED_SETTLEMENT_PERCENT = 0.999;
export const INTL_DEVELOPER_MARKUP_PERCENT = BRIDGE_DEVELOPER_FEE_PERCENT.fiat; // 2.5

export interface PayoutFeeInput {
  corridor:        Corridor;
  accountType:     FeeAccount;
  amount:          number;   // source-currency amount being sent
  /** Third-party / local settlement cost passed through at cost (absolute). */
  passThroughCost?: number;
}

export interface FeeLine { label: string; percent?: number; amount: number }

export interface PayoutFeeResult {
  corridor:        Corridor;
  feePercent:      number;   // our combined % (excludes absolute pass-through)
  percentFee:      number;   // amount * feePercent / 100
  passThroughCost: number;   // absolute, at cost
  totalFee:        number;   // percentFee + passThroughCost (what we disclose)
  netAmount:       number;   // amount - totalFee (delivered to recipient)
  breakdown:       FeeLine[]; // neutral labels — no provider name
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

export function computePayoutFee(input: PayoutFeeInput): PayoutFeeResult {
  const amount      = Math.max(0, Number(input.amount) || 0);
  const passThrough = Math.max(0, Number(input.passThroughCost) || 0);
  const breakdown: FeeLine[] = [];
  let feePercent = 0;

  if (input.corridor === 'international') {
    const parts: ReadonlyArray<readonly [string, number]> = [
      ['Orchestration',  INTL_ORCHESTRATION_PERCENT],
      ['Settlement',     INTL_FIXED_SETTLEMENT_PERCENT],
      ['BorderPay fee',  INTL_DEVELOPER_MARKUP_PERCENT],
    ];
    for (const [label, pct] of parts) {
      feePercent += pct;
      breakdown.push({ label, percent: pct, amount: round2(amount * pct / 100) });
    }
  } else {
    const markup = africanPayoutMarkupPercentForAccount(input.accountType);
    feePercent += markup;
    breakdown.push({ label: 'BorderPay fee', percent: markup, amount: round2(amount * markup / 100) });
  }

  const percentFee = round2(amount * feePercent / 100);
  if (passThrough > 0) breakdown.push({ label: 'Network fee', amount: round2(passThrough) });

  const totalFee = round2(percentFee + passThrough);
  return {
    corridor:        input.corridor,
    feePercent:      round2(feePercent),
    percentFee,
    passThroughCost: round2(passThrough),
    totalFee,
    netAmount:       round2(Math.max(0, amount - totalFee)),
    breakdown,
  };
}

/** Single disclosed total label for the checkout summary (provider hidden). */
export function feeSummaryLabel(result: PayoutFeeResult): string {
  return `BorderPay fee: ${result.totalFee.toFixed(2)} (${result.feePercent.toFixed(2)}%${result.passThroughCost > 0 ? ' + network' : ''})`;
}

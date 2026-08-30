export type YellowCardQuoteDirection = "receive" | "payout";

/**
 * Yellow Card rates are local-currency units per USD.
 *
 * - payout: BorderPay supplies USD digital dollars, recipient gets local fiat
 * - receive: payer supplies local fiat, BorderPay user gets USD digital dollars
 */
export function yellowCardDestinationAmount(
  sourceAmount: number,
  localPerUsdRate: number,
  direction: YellowCardQuoteDirection,
): number {
  if (!Number.isFinite(sourceAmount) || sourceAmount <= 0) {
    throw new Error("yellow_card_invalid_source_amount");
  }
  if (!Number.isFinite(localPerUsdRate) || localPerUsdRate <= 0) {
    throw new Error("yellow_card_invalid_rate");
  }
  return direction === "receive"
    ? sourceAmount / localPerUsdRate
    : sourceAmount * localPerUsdRate;
}

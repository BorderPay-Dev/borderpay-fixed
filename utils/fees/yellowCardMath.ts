export function convertYellowCardLocalFeeToFunding(
  localFee: number,
  localAmount: number,
  fundingAmount: number,
): number {
  if (![localFee, localAmount, fundingAmount].every(Number.isFinite) ||
      localFee < 0 || localAmount <= 0 || fundingAmount <= 0) return 0;
  return (localFee / localAmount) * fundingAmount;
}

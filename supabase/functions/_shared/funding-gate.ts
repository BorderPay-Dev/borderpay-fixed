/** Legacy minimum-balance gate retained for older imports.
 * Balance sufficiency is enforced by provider operations themselves. */

export const FUNDING_REQUIRED_CODE = "funding_required";
export const MIN_WALLET_BALANCE_USD = 20;
export const MIN_WALLET_BALANCE_USD_BUSINESS = 50;
export const minimumWalletBalanceUsd = (isBusiness: boolean) =>
  isBusiness ? MIN_WALLET_BALANCE_USD_BUSINESS : MIN_WALLET_BALANCE_USD;

export type FundingGateResult =
  | { allowed: true; currentUsd: number }
  | { allowed: false; code: string; status: number; body: Record<string, unknown>; currentUsd: number };

export async function requireMinimumWalletBalance(
  supa: { from: (t: string) => any },
  userId: string,
  opts: { isBusiness?: boolean; minUsd?: number; bridgeCustomerId?: string } = {},
): Promise<FundingGateResult> {
  void supa;
  void userId;
  void opts;
  return { allowed: true, currentUsd: 0 };
}

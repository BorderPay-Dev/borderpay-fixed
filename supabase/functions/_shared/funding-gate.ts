/**
 * Minimum-wallet-funding gate.
 *
 * Replaces the old "activated plan" paid-gate. BorderPay no longer charges an
 * activation fee — users instead must hold a minimum balance ($20 USD-equiv)
 * in their BorderPay wallets to unlock money-movement / VA creation. The
 * funds REMAIN the user's; nothing is deducted.
 *
 * Balance sources (summed as USD-equivalent):
 *   • bridge_virtual_account_balances (per-currency available_balance_minor)
 *   • bridge_wallet_balances_minor (stablecoins; if mirrored locally)
 *
 * FX (conservative, lenient — we never want to block a genuinely funded user):
 *   USD = 1.00, EUR = 1.00, GBP = 1.00, USDC/USDT/USDB/PYUSD = 1.00
 *   (No live FX engine yet; using 1:1 means the gate only blocks empty
 *    accounts. Tighten when we wire real rates.)
 */

export const FUNDING_REQUIRED_CODE = "funding_required";
// Per CEO: individuals must hold ≥ $20, businesses ≥ $100. Funds are NOT deducted.
export const MIN_WALLET_BALANCE_USD          = 20;   // individual floor
export const MIN_WALLET_BALANCE_USD_BUSINESS = 100;  // business floor
export const minimumWalletBalanceUsd = (isBusiness: boolean) =>
  isBusiness ? MIN_WALLET_BALANCE_USD_BUSINESS : MIN_WALLET_BALANCE_USD;

const fundingMessage = (minUsd: number) =>
  `Fund your BorderPay wallet with at least $${minUsd} to unlock global virtual accounts. ` +
  `Your funds remain yours and can be used for transfers, payments, and treasury operations.`;

export type FundingGateResult =
  | { allowed: true;  currentUsd: number }
  | { allowed: false; code: string; status: number; body: Record<string, unknown>; currentUsd: number };

const FX_TO_USD: Record<string, number> = {
  USD: 1, EUR: 1, GBP: 1,
  USDC: 1, USDT: 1, USDB: 1, PYUSD: 1, EURC: 1,
};

async function sumVirtualAccountBalancesUsd(
  supa: { from: (t: string) => any },
  userId: string,
): Promise<number> {
  try {
    const { data } = await supa
      .from("bridge_virtual_account_balances")
      .select("currency, available_balance_minor")
      .eq("user_id", userId);
    if (!Array.isArray(data)) return 0;
    let total = 0;
    for (const r of data) {
      const cur = String(r?.currency || "").toUpperCase();
      const rate = FX_TO_USD[cur] ?? 0;
      total += (Number(r?.available_balance_minor || 0) / 100) * rate;
    }
    return total;
  } catch { return 0; }
}

async function sumStablecoinBalancesUsd(
  supa: { from: (t: string) => any },
  userId: string,
): Promise<number> {
  // Optional local mirror (best-effort — table may not exist yet).
  try {
    const { data } = await supa
      .from("bridge_wallet_balances")
      .select("currency, balance_minor")
      .eq("user_id", userId);
    if (!Array.isArray(data)) return 0;
    let total = 0;
    for (const r of data) {
      const cur = String(r?.currency || "").toUpperCase();
      const rate = FX_TO_USD[cur] ?? 0;
      total += (Number(r?.balance_minor || 0) / 100) * rate;
    }
    return total;
  } catch { return 0; }
}

/**
 * Returns { allowed:true } when total wallet balance ≥ the per-account-type
 * minimum (individual $20, business $100). Returns funding_required (402) with
 * the user-facing funding message otherwise. Callers SHOULD pass `isBusiness`
 * (or a custom `minUsd`); we default to the individual floor for safety.
 */
export async function requireMinimumWalletBalance(
  supa: { from: (t: string) => any },
  userId: string,
  opts: { isBusiness?: boolean; minUsd?: number } = {},
): Promise<FundingGateResult> {
  const minUsd = opts.minUsd ?? minimumWalletBalanceUsd(!!opts.isBusiness);
  const [vaUsd, stableUsd] = await Promise.all([
    sumVirtualAccountBalancesUsd(supa, userId),
    sumStablecoinBalancesUsd(supa, userId),
  ]);
  const currentUsd = vaUsd + stableUsd;
  if (currentUsd + 1e-9 >= minUsd) return { allowed: true, currentUsd };

  return {
    allowed:    false,
    code:       FUNDING_REQUIRED_CODE,
    status:     402,
    currentUsd,
    body: {
      success:           false,
      code:              FUNDING_REQUIRED_CODE,
      error:             fundingMessage(minUsd),
      minimum_usd:       minUsd,
      current_balance_usd: Math.round(currentUsd * 100) / 100,
      account_type:      opts.isBusiness ? "business" : "individual",
    },
  };
}

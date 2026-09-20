// Preserved production v384 module. See PROVENANCE.json before changing this graph.
/** Legacy minimum-balance gate retained for older imports.
 * Balance sufficiency is enforced by provider operations themselves. */
export const FUNDING_REQUIRED_CODE = "funding_required";
export const MIN_WALLET_BALANCE_USD = 20;
export const MIN_WALLET_BALANCE_USD_BUSINESS = 50;
export const minimumWalletBalanceUsd = (isBusiness) => isBusiness ? MIN_WALLET_BALANCE_USD_BUSINESS : MIN_WALLET_BALANCE_USD;
export async function requireMinimumWalletBalance(supa, userId, opts = {}) {
    void supa;
    void userId;
    void opts;
    return { allowed: true, currentUsd: 0 };
}

/**
 * Minimum stablecoin-funding gate.
 *
 * Product rule:
 * - Individual: >= $20
 * - Business:   >= $50
 *
 * Source of truth:
 * - Bridge stablecoin wallet balances only.
 *
 * Explicitly excluded:
 * - Virtual account balances
 * - Any fabricated 1:1 cross-currency FX assumptions
 */

import { bridgeProvider } from "./providers/bridge.ts";

export const FUNDING_REQUIRED_CODE = "funding_required";
// Per product policy: individuals must hold ≥ $20, businesses ≥ $50. Funds are NOT deducted.
export const MIN_WALLET_BALANCE_USD          = 20;   // individual floor
export const MIN_WALLET_BALANCE_USD_BUSINESS = 50;   // business floor
export const minimumWalletBalanceUsd = (isBusiness: boolean) =>
  isBusiness ? MIN_WALLET_BALANCE_USD_BUSINESS : MIN_WALLET_BALANCE_USD;

const fundingMessage = (minUsd: number) =>
  `Fund your BorderPay wallet with at least $${minUsd} to unlock global virtual accounts. ` +
  `Your funds remain yours and can be used for transfers, payments, and treasury operations.`;

export type FundingGateResult =
  | { allowed: true;  currentUsd: number }
  | { allowed: false; code: string; status: number; body: Record<string, unknown>; currentUsd: number };

const USD_PEGGED_STABLECOINS = new Set(["USDC", "USDT", "USDB", "PYUSD"]);
const FUNDING_OUTAGE_POLICY = (Deno.env.get("FUNDING_GATE_OUTAGE_POLICY") || "fail_closed").toLowerCase();

function parseDecimalAmount(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const raw = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

async function resolveBridgeCustomerId(
  supa: { from: (t: string) => any },
  userId: string,
  isBusiness: boolean,
): Promise<string | null> {
  const table = isBusiness ? "business_profiles" : "user_profiles";
  const idCol = isBusiness ? "user_id" : "id";
  const { data } = await supa.from(table).select("bridge_customer_id").eq(idCol, userId).maybeSingle();
  return data?.bridge_customer_id ? String(data.bridge_customer_id) : null;
}

/**
 * Returns { allowed:true } when total wallet balance ≥ the per-account-type
 * minimum (individual $20, business $50). Returns funding_required (402) with
 * the user-facing funding message otherwise. Callers SHOULD pass `isBusiness`
 * (or a custom `minUsd`); we default to the individual floor for safety.
 */
export async function requireMinimumWalletBalance(
  supa: { from: (t: string) => any },
  userId: string,
  opts: { isBusiness?: boolean; minUsd?: number; bridgeCustomerId?: string } = {},
): Promise<FundingGateResult> {
  const minUsd = opts.minUsd ?? minimumWalletBalanceUsd(!!opts.isBusiness);
  const isBusiness = !!opts.isBusiness;
  const bridgeCustomerId = opts.bridgeCustomerId ?? await resolveBridgeCustomerId(supa, userId, isBusiness);
  if (!bridgeCustomerId) {
    return {
      allowed: false,
      code: FUNDING_REQUIRED_CODE,
      status: 402,
      currentUsd: 0,
      body: {
        success: false,
        code: FUNDING_REQUIRED_CODE,
        error: fundingMessage(minUsd),
        minimum_usd: minUsd,
        current_balance_usd: 0,
        account_type: isBusiness ? "business" : "individual",
      },
    };
  }

  // Provider truth: only Bridge stablecoin wallet balances count.
  // We explicitly keep chain+asset granularity and aggregate only USD-pegged
  // stablecoin balances into USD thresholds.
  let currentUsd = 0;
  try {
    const wallets = await bridgeProvider.listWallets(bridgeCustomerId);
    for (const wallet of wallets) {
      const symbol = String(wallet.currency || "").toUpperCase();
      if (!USD_PEGGED_STABLECOINS.has(symbol)) continue;

      const direct = parseDecimalAmount(wallet.balance);
      if (direct !== null && direct > 0) {
        currentUsd += direct;
        continue;
      }

      // Fallback for API shapes that omit list-level balances.
      const balanceRows = await bridgeProvider.getWalletBalances(bridgeCustomerId, String(wallet.wallet_id));
      for (const row of balanceRows) {
        const rowSymbol = String(row.currency || symbol).toUpperCase();
        if (!USD_PEGGED_STABLECOINS.has(rowSymbol)) continue;
        const amount = parseDecimalAmount(row.balance);
        if (amount !== null && amount > 0) currentUsd += amount;
      }
    }
  } catch (e) {
    // Bridge-first policy: never invent balances. Default is fail-closed.
    if (FUNDING_OUTAGE_POLICY !== "grace_window") {
      return {
        allowed: false,
        code: "funding_balance_unavailable",
        status: 503,
        currentUsd: 0,
        body: {
          success: false,
          code: "funding_balance_unavailable",
          error: "We could not verify your wallet balances right now. Please retry shortly.",
          minimum_usd: minUsd,
          account_type: isBusiness ? "business" : "individual",
          retryable: true,
        },
      };
    }
    // Grace-window mode is intentionally not enabled by default because this
    // runtime has no durable, integrity-verified balance cache primitive.
    // Keep fail-closed behavior even if misconfigured.
    return {
      allowed: false,
      code: "funding_balance_unavailable",
      status: 503,
      currentUsd: 0,
      body: {
        success: false,
        code: "funding_balance_unavailable",
        error: "Balance verification is temporarily unavailable. Please retry shortly.",
        minimum_usd: minUsd,
        account_type: isBusiness ? "business" : "individual",
        retryable: true,
        policy: "fail_closed",
        detail: (e as Error).message,
      },
    };
  }

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
      account_type:      isBusiness ? "business" : "individual",
    },
  };
}

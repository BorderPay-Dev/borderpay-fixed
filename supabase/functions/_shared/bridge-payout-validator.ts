/**
 * BridgePayoutValidator
 * ---------------------------------------------------------------------------
 * Enforces BorderPay crypto payout safety rules before calling Bridge.
 *
 * Active production Bridge Wallet payout pathways:
 *   1) USDC on BASE
 *   2) USDT on TRON
 *
 * BorderPay fee policy:
 *   - USD 1.00 flat.
 *
 * The Bridge request amount is the user-entered transfer amount. Bridge rejects
 * `developer_fee` on same-currency crypto payouts (for example usdt -> usdt),
 * so the transfer edge function must not send the fee field for those routes.
 */

export const BRIDGE_PAYOUT_DEVELOPER_FEE_USD = "1.00";
export const BRIDGE_PAYOUT_ORCHESTRATION_BPS = 0;

type SupportedRoute = {
  chain: "BASE" | "TRON";
  currency: "USDC" | "USDT";
  min_usd: number;
};

type SupportedBridgeDestinationRail = "base" | "tron";

const ROUTES: Record<string, SupportedRoute> = {
  "BASE:USDC": { chain: "BASE", currency: "USDC", min_usd: 1.0 },
  "TRON:USDT": { chain: "TRON", currency: "USDT", min_usd: 5.0 },
};

const BRIDGE_CHAIN_RAILS = new Set(["base", "tron"]);

export type BridgePayoutValidationOk = {
  ok: true;
  enforced: {
    source_payment_rail: "bridge_wallet";
    destination_payment_rail: SupportedBridgeDestinationRail;
    chain: "BASE" | "TRON";
    currency: "USDC" | "USDT";
    amount: string; // 2dp
    developer_fee: string; // 2dp
    minimum: string; // 2dp
  };
};

export type BridgePayoutValidationFail = {
  ok: false;
  status: number;
  body: Record<string, unknown>;
};

export type BridgePayoutValidationResult = BridgePayoutValidationOk | BridgePayoutValidationFail;

function normalizeRail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function bridgeDestinationRail(chain: SupportedRoute["chain"]): SupportedBridgeDestinationRail {
  return chain === "TRON" ? "tron" : "base";
}

function normalizeChain(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

function normalizeCurrency(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

function parseDecimalToCents(v: unknown): number | null {
  const raw = String(v ?? "").trim();
  if (!/^\d+(\.\d{1,12})?$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function centsToFixed(cents: number): string {
  return (cents / 100).toFixed(2);
}

function parseFixedToCents(v: string): number {
  const n = Number(v);
  return Math.round(n * 100);
}

function computeDeveloperFeeCents(_amountCents: number): number {
  const flatCents = parseFixedToCents(BRIDGE_PAYOUT_DEVELOPER_FEE_USD);
  return flatCents;
}

/**
 * Returns true when the request is a Bridge Wallet to blockchain crypto payout.
 */
export function isCryptoToCryptoTransfer(body: any): boolean {
  const srcRail = normalizeRail(body?.source?.payment_rail);
  const dstRail = normalizeRail(body?.destination?.payment_rail);
  return (
    srcRail === "bridge_wallet" &&
    BRIDGE_CHAIN_RAILS.has(dstRail)
  );
}

/**
 * Validate + normalize payout payload for supported Bridge Wallet crypto payout routes.
 * Non-crypto transfers are intentionally out-of-scope and return ok=true with
 * no enforced payload.
 */
export function validateBridgePayout(body: any): BridgePayoutValidationResult {
  if (!isCryptoToCryptoTransfer(body)) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: "unsupported_payout_type",
        error: "Only Bridge Wallet to supported blockchain crypto payouts are supported.",
      },
    };
  }

  const sourceRail = normalizeRail(body?.source?.payment_rail);
  const sourceChain = normalizeChain(body?.source?.chain);
  const destinationRail = normalizeRail(body?.destination?.payment_rail);
  const destinationChain = normalizeChain(
    body?.destination?.chain ||
    (destinationRail === "base" ? "BASE" : destinationRail === "tron" ? "TRON" : ""),
  );
  const sourceCurrency = normalizeCurrency(body?.source?.currency);
  const destinationCurrency = normalizeCurrency(body?.destination?.currency);

  if (!destinationChain || (sourceRail !== "bridge_wallet" && (!sourceChain || sourceChain !== destinationChain))) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: "chain_mismatch",
        error: "Destination chain is required for Bridge Wallet crypto payouts.",
      },
    };
  }
  if (!sourceCurrency || !destinationCurrency || sourceCurrency !== destinationCurrency) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: "currency_mismatch",
        error: "Source and destination currency must match for crypto payouts.",
      },
    };
  }

  const route = ROUTES[`${destinationChain}:${sourceCurrency}`];
  if (!route) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: "unsupported_crypto_route",
        error: "Supported crypto payout routes are USDC on BASE and USDT on TRON only.",
      },
    };
  }

  const amountCents = parseDecimalToCents(body?.source?.amount);
  if (amountCents == null) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: "invalid_amount",
        error: "source.amount must be a positive transfer amount.",
      },
    };
  }

  const feeCents = computeDeveloperFeeCents(amountCents);
  const minCents = Math.round(route.min_usd * 100);
  if (amountCents < minCents) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: "amount_below_minimum",
        error: `Transfer amount is below the minimum for ${route.currency} on ${route.chain}.`,
        details: {
          route: `${route.currency}:${route.chain}`,
          amount: centsToFixed(amountCents),
          minimum: centsToFixed(minCents),
        },
      },
    };
  }

  return {
    ok: true,
    enforced: {
      source_payment_rail: "bridge_wallet",
      destination_payment_rail: bridgeDestinationRail(route.chain),
      chain: route.chain,
      currency: route.currency,
      amount: centsToFixed(amountCents),
      developer_fee: centsToFixed(feeCents),
      minimum: centsToFixed(minCents),
    },
  };
}

/**
 * Deterministic simulation helper for operator docs and tests.
 */
export function simulateBridgePayoutValidation(input: {
  chain: string;
  currency: string;
  destination_amount?: string;
  gross_amount?: string;
}): Record<string, unknown> {
  const body = {
    source: {
      payment_rail: "bridge_wallet",
      chain: input.chain,
      currency: input.currency,
      amount: input.destination_amount ?? input.gross_amount,
    },
    destination: {
      payment_rail: bridgeDestinationRail(normalizeChain(input.chain) === "TRON" ? "TRON" : "BASE"),
      chain: input.chain,
      currency: input.currency,
      to_address: "simulated_destination",
    },
  };
  const res = validateBridgePayout(body);
  return res.ok
    ? { accepted: true, ...res.enforced }
    : { accepted: false, status: res.status, ...(res.body || {}) };
}

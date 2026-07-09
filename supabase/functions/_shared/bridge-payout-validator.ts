/**
 * BridgePayoutValidator
 * ---------------------------------------------------------------------------
 * Enforces BorderPay crypto payout safety rules before calling Bridge.
 *
 * Active production crypto payout pathways:
 *   1) USDC on BASE
 *   2) USDT on TRON
 *
 * Developer fee:
 *   - USD 1.00 flat + 0.25% of the requested destination amount.
 *
 * Dust prevention:
 *   - Bridge minimum is enforced on NET destination amount:
 *       net = gross - developer_fee
 *   - Requests that would settle below the rail minimum are rejected
 *     before Bridge API execution.
 */

export const BRIDGE_PAYOUT_DEVELOPER_FEE_USD = "1.00";
export const BRIDGE_PAYOUT_ORCHESTRATION_BPS = 25; // 0.25%

type SupportedRoute = {
  chain: "BASE" | "TRON";
  currency: "USDC" | "USDT";
  // Absolute gross lower bound we enforce at request boundary.
  gross_min_usd: number;
  // Bridge-safe post-fee minimum (net destination amount).
  net_min_usd: number;
};

type SupportedBridgeDestinationRail = "base" | "tron";

const ROUTES: Record<string, SupportedRoute> = {
  "BASE:USDC": { chain: "BASE", currency: "USDC", gross_min_usd: 2.0, net_min_usd: 1.0 },
  "TRON:USDT": { chain: "TRON", currency: "USDT", gross_min_usd: 4.0, net_min_usd: 3.0 },
};

export type BridgePayoutValidationOk = {
  ok: true;
  enforced: {
    source_payment_rail: "bridge_wallet";
    destination_payment_rail: SupportedBridgeDestinationRail;
    chain: "BASE" | "TRON";
    currency: "USDC" | "USDT";
    requested_destination_amount: string; // 2dp
    gross_amount: string; // 2dp
    developer_fee: string; // 2dp
    net_destination_amount: string; // 2dp
    gross_minimum: string; // 2dp
    net_minimum: string; // 2dp
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

function computeDeveloperFeeCents(destinationAmountCents: number): number {
  const flatCents = parseFixedToCents(BRIDGE_PAYOUT_DEVELOPER_FEE_USD);
  const orchestrationCents = Math.round(destinationAmountCents * BRIDGE_PAYOUT_ORCHESTRATION_BPS / 10_000);
  return flatCents + orchestrationCents;
}

/**
 * Returns true when the request is a crypto-to-crypto stablecoin payout.
 */
export function isCryptoToCryptoTransfer(body: any): boolean {
  const srcRail = normalizeRail(body?.source?.payment_rail);
  const dstRail = normalizeRail(body?.destination?.payment_rail);
  return srcRail === "stablecoin" && dstRail === "stablecoin";
}

/**
 * Validate + normalize payout payload for supported crypto payout routes.
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
        error: "Only stablecoin-to-stablecoin crypto payouts are supported by this payout validator.",
      },
    };
  }

  const sourceChain = normalizeChain(body?.source?.chain);
  const destinationChain = normalizeChain(body?.destination?.chain);
  const sourceCurrency = normalizeCurrency(body?.source?.currency);
  const destinationCurrency = normalizeCurrency(body?.destination?.currency);

  if (!sourceChain || !destinationChain || sourceChain !== destinationChain) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: "chain_mismatch",
        error: "Source and destination chain must match for crypto payouts.",
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

  const route = ROUTES[`${sourceChain}:${sourceCurrency}`];
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

  const requestedDestinationCents = parseDecimalToCents(body?.source?.amount);
  if (requestedDestinationCents == null) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: "invalid_amount",
        error: "source.amount must be a positive destination amount.",
      },
    };
  }

  const feeCents = computeDeveloperFeeCents(requestedDestinationCents);
  const grossCents = requestedDestinationCents + feeCents;
  const grossMinCents = Math.round(route.gross_min_usd * 100);
  const netMinCents = Math.round(route.net_min_usd * 100);
  const netCents = requestedDestinationCents;

  if (grossCents < grossMinCents) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: "gross_below_minimum",
        error: `Gross transfer amount is below the minimum for ${route.currency} on ${route.chain}.`,
        details: {
          route: `${route.currency}:${route.chain}`,
          gross_amount: centsToFixed(grossCents),
          gross_minimum: centsToFixed(grossMinCents),
          developer_fee: centsToFixed(feeCents),
        },
      },
    };
  }

  if (netCents < netMinCents) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: "dust_minimum_not_met",
        error: "Transfer blocked to prevent dust: net destination amount falls below the route minimum after fee deduction.",
        details: {
          route: `${route.currency}:${route.chain}`,
          gross_amount: centsToFixed(grossCents),
          developer_fee: centsToFixed(feeCents),
          net_destination_amount: centsToFixed(netCents),
          net_minimum: centsToFixed(netMinCents),
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
      requested_destination_amount: centsToFixed(requestedDestinationCents),
      gross_amount: centsToFixed(grossCents),
      developer_fee: centsToFixed(feeCents),
      net_destination_amount: centsToFixed(netCents),
      gross_minimum: centsToFixed(grossMinCents),
      net_minimum: centsToFixed(netMinCents),
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
      payment_rail: "stablecoin",
      chain: input.chain,
      currency: input.currency,
      amount: input.destination_amount ?? input.gross_amount,
    },
    destination: {
      payment_rail: "stablecoin",
      chain: input.chain,
      currency: input.currency,
      address: "simulated_destination",
    },
  };
  const res = validateBridgePayout(body);
  return res.ok
    ? { accepted: true, ...res.enforced }
    : { accepted: false, status: res.status, ...(res.body || {}) };
}

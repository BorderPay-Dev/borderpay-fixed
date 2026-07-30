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
 *   - Same-token wallet payouts cannot carry Bridge developer_fee_percent.
 *     Bridge rejects USDC->USDC / USDT->USDT payouts when developer_fee is set.
 *   - The send endpoint still rejects manual unsaved addresses so every payout
 *     uses a Bridge-registered external wallet route for operator traceability.
 *
 * Dust prevention:
 *   - Bridge minimum is enforced on destination amount:
 *       net = gross
 *   - Requests that would settle below the rail minimum are rejected
 *     before Bridge API execution.
 */

export const BRIDGE_PAYOUT_DEVELOPER_FEE_PERCENT = 0.0;

type SupportedRoute = {
  chain: "BASE" | "TRON";
  currency: "USDC" | "USDT";
  // Absolute gross lower bound we enforce at request boundary.
  gross_min_usd: number;
  // Bridge-safe post-fee minimum (net destination amount).
  net_min_usd: number;
};

const ROUTES: Record<string, SupportedRoute> = {
  "BASE:USDC": { chain: "BASE", currency: "USDC", gross_min_usd: 2.0, net_min_usd: 1.0 },
  "TRON:USDT": { chain: "TRON", currency: "USDT", gross_min_usd: 4.0, net_min_usd: 3.0 },
};

export type BridgePayoutValidationOk = {
  ok: true;
  enforced: {
    source_payment_rail: "bridge_wallet";
    destination_payment_rail: "base" | "tron";
    chain: "BASE" | "TRON";
    currency: "USDC" | "USDT";
    gross_amount: string; // 2dp
    developer_fee: string; // fixed decimal, 2dp
    bridge_developer_fee: string | null; // always null for crypto payouts
    is_cross_token: boolean;
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

function normalizeChain(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

function normalizeCurrency(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

function chainFromDestination(body: any): string {
  const chain = normalizeChain(body?.destination?.chain);
  if (chain) return chain;
  const rail = normalizeRail(body?.destination?.payment_rail);
  const railMap: Record<string, string> = {
    base: "BASE",
    tron: "TRON",
  };
  return railMap[rail] || "";
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

/**
 * Returns true when the request is a Bridge-wallet payout to a supported chain.
 */
export function isCryptoToCryptoTransfer(body: any): boolean {
  const srcRail = normalizeRail(body?.source?.payment_rail);
  const dstRail = normalizeRail(body?.destination?.payment_rail);
  return srcRail === "bridge_wallet"
    && (dstRail === "base" || dstRail === "tron");
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
        error: "Only Bridge wallet payouts to Base or Tron are supported by this payout validator.",
      },
    };
  }

  const sourceCurrency = normalizeCurrency(body?.source?.currency);
  const destinationCurrency = normalizeCurrency(body?.destination?.currency);
  const destinationChain = chainFromDestination(body);

  if (!destinationChain) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: "chain_mismatch",
        error: "Destination chain is required for crypto payouts.",
      },
    };
  }
  if (sourceCurrency !== "USDC" && sourceCurrency !== "USDT") {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: "unsupported_crypto_source",
        error: "Supported source currencies are USDC and USDT only.",
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

  const grossCents = parseDecimalToCents(body?.source?.amount);
  if (grossCents == null) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: "invalid_amount",
        error: "source.amount must be a positive decimal number.",
      },
    };
  }

  const isCrossToken = sourceCurrency !== destinationCurrency;
  const feeCents = 0;
  const grossMinCents = Math.round(route.gross_min_usd * 100);
  const netMinCents = Math.round(route.net_min_usd * 100);
  const netCents = grossCents - feeCents;

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
      destination_payment_rail: route.chain === "BASE" ? "base" : "tron",
      chain: route.chain,
      currency: route.currency,
      gross_amount: centsToFixed(grossCents),
      developer_fee: centsToFixed(feeCents),
      bridge_developer_fee: null,
      is_cross_token: isCrossToken,
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
  gross_amount: string;
}): Record<string, unknown> {
  const body = {
    source: {
      payment_rail: "bridge_wallet",
      currency: input.currency,
      amount: input.gross_amount,
      bridge_wallet_id: "simulated_bridge_wallet",
    },
    destination: {
      payment_rail: String(input.chain || "").toLowerCase(),
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

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  checkIpAllowlist,
  consumeRateLimit,
  createAdminClient,
  extractClientIp,
  GATEWAY_CORS,
  gatewayError,
  gatewayJson,
  logGatewayRequest,
  parseBearerToken,
  resolveGatewayContext,
  sha256Hex,
} from "../_shared/api-gateway.ts";
import {
  bridgeProvider,
  BridgeProviderError,
} from "../_shared/providers/bridge.ts";
import {
  loadVirtualAccountDeveloperFeePercent,
} from "../_shared/providers/virtual-account-config.ts";
import {
  validateCustomerCreate,
  validateIdempotencyHeader,
  validateTransferOrPayout,
  validateVirtualAccountCreate,
  validateWalletCreate,
  validateWebhookCreate,
} from "../_shared/api-gateway-validators.ts";

const ROUTE_SCOPE_MAP: Record<string, string | null> = {
  "GET /v1/health": null,
  "POST /v1/customers": "customers:write",
  "POST /v1/wallets": "wallets:write",
  "POST /v1/virtual-accounts": "virtual_accounts:write",
  "POST /v1/transfers": "transfers:write",
  "POST /v1/payouts": "payouts:write",
  "POST /v1/webhooks": "webhooks:write",
};

type GatewayHandlerResult = {
  status: number;
  body: Record<string, unknown>;
};

const IDEMPOTENT_ROUTES = new Set([
  "POST /v1/customers",
  "POST /v1/wallets",
  "POST /v1/virtual-accounts",
  "POST /v1/transfers",
  "POST /v1/payouts",
  "POST /v1/webhooks",
]);

function normalizeRoute(
  req: Request,
  body: any,
): { method: string; route: string; routeKey: string } {
  const method = String(body?.method || req.method || "GET").toUpperCase();

  const fromHeader = req.headers.get("x-borderpay-route")?.trim();
  const fromBody = typeof body?.route === "string" ? body.route.trim() : "";
  let route = fromHeader || fromBody;

  if (!route) {
    const pathname = new URL(req.url).pathname;
    const marker = "/public-api-gateway";
    const i = pathname.indexOf(marker);
    if (i >= 0) {
      route = pathname.slice(i + marker.length) || "/";
    }
  }

  if (!route.startsWith("/")) route = `/${route}`;
  if (route.length > 1 && route.endsWith("/")) route = route.slice(0, -1);

  return { method, route, routeKey: `${method} ${route}` };
}

function hasScope(scopes: string[], requiredScope: string | null): boolean {
  if (!requiredScope) return true;
  if (scopes.includes("*")) return true;
  return scopes.includes(requiredScope);
}

function normalizeMode(input: unknown): "sandbox" | "production" | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const m = input.trim().toLowerCase();
  if (m === "sandbox" || m === "production") return m;
  return null;
}

function isClosedBetaEnabled(): boolean {
  const flag = (Deno.env.get("API_V1_CLOSED_BETA") ?? "true").trim()
    .toLowerCase();
  return !(flag === "0" || flag === "false" || flag === "off");
}

function parseGrossAmountUsd(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const candidate = (body as any)?.transfer?.amount ??
    (body as any)?.payout?.amount ??
    (body as any)?.amount;
  const n = Number(candidate);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

async function findReplay(
  supa: ReturnType<typeof createAdminClient>,
  tenantId: string,
  apiKeyId: string,
  routeKey: string,
  idempotencyKey: string,
) {
  const { data, error } = await supa
    .from("api_idempotency_replays")
    .select("request_hash, status_code, response_body")
    .eq("tenant_id", tenantId)
    .eq("api_key_id", apiKeyId)
    .eq("route_key", routeKey)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw new Error(`idempotency lookup failed: ${error.message}`);
  return data;
}

async function storeReplay(
  supa: ReturnType<typeof createAdminClient>,
  params: {
    tenantId: string;
    apiKeyId: string;
    routeKey: string;
    idempotencyKey: string;
    requestHash: string;
    statusCode: number;
    responseBody: Record<string, unknown>;
    errorCode?: string | null;
  },
) {
  const { error } = await supa.from("api_idempotency_replays").insert({
    tenant_id: params.tenantId,
    api_key_id: params.apiKeyId,
    route_key: params.routeKey,
    idempotency_key: params.idempotencyKey,
    request_hash: params.requestHash,
    status_code: params.statusCode,
    response_body: params.responseBody,
    error_code: params.errorCode ?? null,
  });
  if (error) {
    console.error("store replay failed", error.message);
  }
}

function mapBridgeError(e: unknown): GatewayHandlerResult {
  if (e instanceof BridgeProviderError) {
    const code = String(e.bridge_code || "").trim().toLowerCase();
    const normalizedCode = code.includes("rate")
      ? "rate_limited"
      : code.includes("unauth")
      ? "unauthorized"
      : code.includes("forbidden")
      ? "forbidden"
      : code.includes("not_found")
      ? "not_found"
      : code.includes("invalid")
      ? "invalid_request"
      : code.includes("timeout") || code.includes("unavailable")
      ? "provider_unavailable"
      : "provider_error";
    const status = e.status && e.status >= 400 && e.status < 600
      ? e.status
      : 502;
    return {
      status,
      body: {
        success: false,
        error: {
          code: normalizedCode,
          message: e.bridge_error || e.message || "Bridge request failed",
        },
      },
    };
  }

  const msg = e instanceof Error ? e.message : "Unknown gateway handler error";
  if (/is required/i.test(msg)) {
    return {
      status: 400,
      body: {
        success: false,
        error: { code: "invalid_request", message: msg },
      },
    };
  }
  return {
    status: 500,
    body: { success: false, error: { code: "internal_error", message: msg } },
  };
}

async function handleRoute(
  supa: ReturnType<typeof createAdminClient>,
  routeKey: string,
  body: any,
  ctx: {
    tenantId: string;
  },
): Promise<GatewayHandlerResult> {
  if (routeKey === "POST /v1/customers") {
    const parsed = validateCustomerCreate(body);
    if (!parsed.ok) {
      return {
        status: 400,
        body: { success: false, error: parsed.error },
      };
    }

    const result = await bridgeProvider.createCustomer(parsed.value);
    return {
      status: 201,
      body: {
        success: true,
        data: {
          customer_id: result.provider_id,
          provider: "borderpay",
        },
      },
    };
  }

  if (routeKey === "POST /v1/wallets") {
    const parsed = validateWalletCreate(body);
    if (!parsed.ok) {
      return {
        status: 400,
        body: { success: false, error: parsed.error },
      };
    }
    const result = await bridgeProvider.createWallet(parsed.value as any);
    return {
      status: 201,
      body: {
        success: true,
        data: {
          wallet_id: result.wallet_id,
          deposit_address: result.deposit_address,
          symbol: result.symbol,
          chain: result.chain,
        },
      },
    };
  }

  if (routeKey === "POST /v1/virtual-accounts") {
    const parsed = validateVirtualAccountCreate(body);
    if (!parsed.ok) {
      return {
        status: 400,
        body: { success: false, error: parsed.error },
      };
    }
    const developerFeePercent = await loadVirtualAccountDeveloperFeePercent(supa);
    const result = await bridgeProvider.createVirtualAccount({
      ...parsed.value,
      developer_fee_percent: developerFeePercent,
    });
    return {
      status: 201,
      body: {
        success: true,
        data: {
          virtual_account_id: result.virtual_account_id,
          currency: result.currency,
          account_number: result.account_number ?? null,
          routing_number: result.routing_number ?? null,
          iban: result.iban ?? null,
          bic: result.bic ?? null,
          bank_name: result.bank_name ?? null,
        },
      },
    };
  }

  if (routeKey === "POST /v1/transfers" || routeKey === "POST /v1/payouts") {
    const parsed = validateTransferOrPayout(body);
    if (!parsed.ok) {
      return {
        status: 400,
        body: { success: false, error: parsed.error },
      };
    }
    const result = await bridgeProvider.createTransfer(parsed.value as any);

    return {
      status: 201,
      body: {
        success: true,
        data: {
          transfer_id: result.transfer_id,
          state: result.state,
          provider: "borderpay",
        },
      },
    };
  }

  if (routeKey === "POST /v1/webhooks") {
    const parsed = validateWebhookCreate(body);
    if (!parsed.ok) {
      return {
        status: 400,
        body: { success: false, error: parsed.error },
      };
    }
    const plainSecret = `bwhsec_${crypto.randomUUID().replaceAll("-", "")}`;
    const signingSecretHash = await sha256Hex(plainSecret);

    const { data, error } = await supa
      .from("api_webhook_endpoints")
      .insert({
        tenant_id: ctx.tenantId,
        endpoint_url: parsed.value.endpoint_url,
        signing_secret_hash: signingSecretHash,
      })
      .select("id, endpoint_url, created_at")
      .single();

    if (error) {
      return {
        status: 500,
        body: {
          success: false,
          error: {
            code: "internal_error",
            message: `Failed to create webhook endpoint: ${error.message}`,
          },
        },
      };
    }

    return {
      status: 201,
      body: {
        success: true,
        data: {
          webhook_id: data.id,
          endpoint_url: data.endpoint_url,
          signing_secret: plainSecret,
          created_at: data.created_at,
        },
      },
    };
  }

  return {
    status: 501,
    body: {
      success: false,
      error: {
        code: "not_implemented",
        message: `Route ${routeKey} is not implemented`,
      },
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: GATEWAY_CORS });
  }

  const startedAt = Date.now();
  const requestId = req.headers.get("x-request-id")?.trim() ||
    crypto.randomUUID();
  const clientIp = extractClientIp(req);

  let tenantId: string | null = null;
  let apiKeyId: string | null = null;
  let route = "/";
  let method = req.method;

  const supa = createAdminClient();

  try {
    const rawToken = parseBearerToken(req);
    if (!rawToken) {
      await logGatewayRequest(supa, {
        requestId,
        method,
        route,
        statusCode: 401,
        errorCode: "unauthorized",
        clientIp,
        latencyMs: Date.now() - startedAt,
      });
      return gatewayError(
        "unauthorized",
        "API key bearer token is required",
        401,
      );
    }

    let body: any = {};
    if (req.method !== "GET" && req.method !== "HEAD") {
      try {
        body = await req.json();
      } catch {
        await logGatewayRequest(supa, {
          requestId,
          method,
          route,
          statusCode: 400,
          errorCode: "invalid_request",
          clientIp,
          latencyMs: Date.now() - startedAt,
        });
        return gatewayError("invalid_request", "Invalid JSON body", 400);
      }
    }

    const resolved = normalizeRoute(req, body);
    route = resolved.route;
    method = resolved.method;

    const ctx = await resolveGatewayContext(supa, rawToken);
    if (!ctx) {
      await logGatewayRequest(supa, {
        requestId,
        method,
        route,
        statusCode: 401,
        errorCode: "unauthorized",
        clientIp,
        latencyMs: Date.now() - startedAt,
      });
      return gatewayError("unauthorized", "Invalid or revoked API key", 401);
    }

    tenantId = ctx.tenantId;
    apiKeyId = ctx.apiKeyId;

    const ipAllowed = await checkIpAllowlist(supa, ctx.tenantId, clientIp);
    if (!ipAllowed) {
      await logGatewayRequest(supa, {
        tenantId,
        apiKeyId,
        requestId,
        method,
        route,
        statusCode: 403,
        errorCode: "forbidden",
        clientIp,
        latencyMs: Date.now() - startedAt,
      });
      return gatewayError(
        "forbidden",
        "Client IP is not allowlisted for this API tenant",
        403,
      );
    }

    const limit = await consumeRateLimit(
      supa,
      ctx.tenantId,
      ctx.apiKeyId,
      ctx.rateLimitPerMinute,
    );
    if (!limit.allowed) {
      await logGatewayRequest(supa, {
        tenantId,
        apiKeyId,
        requestId,
        method,
        route,
        statusCode: 429,
        errorCode: "rate_limited",
        clientIp,
        latencyMs: Date.now() - startedAt,
        metadata: {
          remaining: limit.remaining,
          reset_at: limit.resetAt,
          current_count: limit.currentCount,
        },
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "rate_limited",
            message:
              "Rate limit exceeded. Retry after the current window resets.",
            details: {
              remaining: limit.remaining,
              reset_at: limit.resetAt,
            },
          },
        }),
        {
          status: 429,
          headers: {
            ...GATEWAY_CORS,
            "Content-Type": "application/json",
            "Retry-After": String(
              Math.max(
                1,
                Math.ceil(
                  (new Date(limit.resetAt).getTime() - Date.now()) / 1000,
                ),
              ),
            ),
          },
        },
      );
    }

    const routeKey = `${method} ${route}`;
    const requiredScope = ROUTE_SCOPE_MAP[routeKey];
    if (requiredScope === undefined) {
      await logGatewayRequest(supa, {
        tenantId,
        apiKeyId,
        requestId,
        method,
        route,
        statusCode: 404,
        errorCode: "not_found",
        clientIp,
        latencyMs: Date.now() - startedAt,
      });
      return gatewayError("not_found", `Unknown API route: ${routeKey}`, 404);
    }

    if (!hasScope(ctx.scopes, requiredScope)) {
      await logGatewayRequest(supa, {
        tenantId,
        apiKeyId,
        requestId,
        method,
        route,
        statusCode: 403,
        errorCode: "forbidden",
        clientIp,
        latencyMs: Date.now() - startedAt,
      });
      return gatewayError(
        "forbidden",
        `Missing required scope: ${requiredScope}`,
        403,
      );
    }

    const requestedMode = normalizeMode(
      req.headers.get("x-borderpay-mode") ?? body?.mode,
    );
    if (requestedMode && requestedMode !== ctx.defaultMode) {
      await logGatewayRequest(supa, {
        tenantId,
        apiKeyId,
        requestId,
        method,
        route,
        statusCode: 403,
        errorCode: "forbidden",
        clientIp,
        latencyMs: Date.now() - startedAt,
        metadata: {
          expected_mode: ctx.defaultMode,
          requested_mode: requestedMode,
        },
      });
      return gatewayError(
        "forbidden",
        `Tenant mode is ${ctx.defaultMode}; requested mode ${requestedMode} is not allowed`,
        403,
      );
    }

    if (isClosedBetaEnabled() && ctx.defaultMode === "production" &&
      !ctx.betaAccessEnabled) {
      await logGatewayRequest(supa, {
        tenantId,
        apiKeyId,
        requestId,
        method,
        route,
        statusCode: 403,
        errorCode: "forbidden",
        clientIp,
        latencyMs: Date.now() - startedAt,
        metadata: {
          reason: "closed_beta_access_required",
          mode: ctx.defaultMode,
        },
      });
      return gatewayError(
        "forbidden",
        "Tenant is not allowlisted for production API beta access",
        403,
      );
    }

    if (routeKey === "GET /v1/health") {
      const status = {
        success: true,
        data: {
          request_id: requestId,
          route: routeKey,
          tenant_id: ctx.tenantId,
          tenant_name: ctx.tenantName,
          mode: ctx.defaultMode,
          rate_limit_per_minute: ctx.rateLimitPerMinute,
          remaining: limit.remaining,
          reset_at: limit.resetAt,
          gateway: "ready",
        },
      };

      await logGatewayRequest(supa, {
        tenantId,
        apiKeyId,
        requestId,
        method,
        route,
        statusCode: 200,
        clientIp,
        latencyMs: Date.now() - startedAt,
        metadata: { route_key: routeKey },
      });

      return gatewayJson(status, 200);
    }
    const isIdempotentRoute = IDEMPOTENT_ROUTES.has(routeKey);
    if (
      (routeKey === "POST /v1/transfers" || routeKey === "POST /v1/payouts") &&
      ctx.maxSingleTransferUsd != null
    ) {
      const grossAmount = parseGrossAmountUsd(body);
      if (grossAmount == null) {
        await logGatewayRequest(supa, {
          tenantId,
          apiKeyId,
          requestId,
          method,
          route,
          statusCode: 400,
          errorCode: "invalid_request",
          clientIp,
          latencyMs: Date.now() - startedAt,
          metadata: { reason: "amount_missing_or_invalid" },
        });
        return gatewayError(
          "invalid_request",
          "Transfer amount is required",
          400,
        );
      }
      if (grossAmount > ctx.maxSingleTransferUsd) {
        await logGatewayRequest(supa, {
          tenantId,
          apiKeyId,
          requestId,
          method,
          route,
          statusCode: 403,
          errorCode: "forbidden",
          clientIp,
          latencyMs: Date.now() - startedAt,
          metadata: {
            reason: "single_transfer_cap_exceeded",
            max_single_transfer_usd: ctx.maxSingleTransferUsd,
            requested_amount: grossAmount,
          },
        });
        return gatewayError(
          "forbidden",
          `Transfer amount exceeds tenant cap of ${ctx.maxSingleTransferUsd.toFixed(2)} USD`,
          403,
        );
      }
    }

    let idempotencyKey = "";
    let requestHash = "";
    if (isIdempotentRoute) {
      const headerValidation = validateIdempotencyHeader(
        req.headers.get("Idempotency-Key"),
      );
      if (!headerValidation.ok) {
        await logGatewayRequest(supa, {
          tenantId,
          apiKeyId,
          requestId,
          method,
          route,
          statusCode: 400,
          errorCode: "idempotency_key_required",
          clientIp,
          latencyMs: Date.now() - startedAt,
        });
        return gatewayJson(
          {
            success: false,
            error: {
              code: "idempotency_key_required",
              message: headerValidation.error.message,
              details: headerValidation.error.details ?? null,
            },
          },
          400,
        );
      }
      idempotencyKey = headerValidation.value;

      requestHash = await sha256Hex(JSON.stringify({
        route_key: routeKey,
        body,
      }));

      const replay = await findReplay(
        supa,
        tenantId,
        apiKeyId,
        routeKey,
        idempotencyKey,
      );
      if (replay) {
        if (String(replay.request_hash) !== requestHash) {
          await logGatewayRequest(supa, {
            tenantId,
            apiKeyId,
            requestId,
            method,
            route,
            statusCode: 409,
            errorCode: "idempotency_replay_mismatch",
            clientIp,
            latencyMs: Date.now() - startedAt,
          });
          return gatewayError(
            "idempotency_replay_mismatch",
            "Idempotency key was reused with a different payload",
            409,
          );
        }
        await logGatewayRequest(supa, {
          tenantId,
          apiKeyId,
          requestId,
          method,
          route,
          statusCode: Number(replay.status_code),
          clientIp,
          latencyMs: Date.now() - startedAt,
          metadata: { replay: true, route_key: routeKey },
        });
        return new Response(JSON.stringify(replay.response_body), {
          status: Number(replay.status_code),
          headers: {
            ...GATEWAY_CORS,
            "Content-Type": "application/json",
            "X-Idempotent-Replay": "true",
          },
        });
      }
    }

    let handlerResult: GatewayHandlerResult;
    try {
      const bodyWithFallbackIdempotency = (() => {
        if (!isIdempotentRoute) return body;
        if (
          routeKey !== "POST /v1/transfers" && routeKey !== "POST /v1/payouts"
        ) return body;

        const transfer = body?.transfer ?? body ?? {};
        if (!transfer.idempotency_key && idempotencyKey) {
          if (body?.transfer) {
            return {
              ...body,
              transfer: { ...body.transfer, idempotency_key: idempotencyKey },
            };
          }
          return {
            ...body,
            idempotency_key: idempotencyKey,
          };
        }
        return body;
      })();

      handlerResult = await handleRoute(
        supa,
        routeKey,
        bodyWithFallbackIdempotency,
        {
          tenantId,
        },
      );
    } catch (e) {
      handlerResult = mapBridgeError(e);
    }

    if (isIdempotentRoute) {
      await storeReplay(supa, {
        tenantId,
        apiKeyId,
        routeKey,
        idempotencyKey,
        requestHash,
        statusCode: handlerResult.status,
        responseBody: handlerResult.body,
        errorCode: handlerResult.status >= 400
          ? String((handlerResult.body as any)?.error?.code ?? "error")
          : null,
      });
    }

    await logGatewayRequest(supa, {
      tenantId,
      apiKeyId,
      requestId,
      method,
      route,
      statusCode: handlerResult.status,
      errorCode: handlerResult.status >= 400
        ? String((handlerResult.body as any)?.error?.code ?? "error")
        : null,
      clientIp,
      latencyMs: Date.now() - startedAt,
      metadata: { route_key: routeKey },
    });

    return gatewayJson(handlerResult.body, handlerResult.status);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown";
    await logGatewayRequest(supa, {
      tenantId,
      apiKeyId,
      requestId,
      method,
      route,
      statusCode: 500,
      errorCode: "internal_error",
      clientIp,
      latencyMs: Date.now() - startedAt,
      metadata: { message: msg },
    });
    return gatewayError("internal_error", "Gateway runtime error", 500, {
      request_id: requestId,
    });
  }
});

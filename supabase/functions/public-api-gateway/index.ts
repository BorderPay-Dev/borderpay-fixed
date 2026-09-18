import { loadPublishedWhiteLabel } from "../_shared/white-label-config.ts";
import { CUSTOMER_API_SCOPES, authenticateApiCustomer, handleCustomerApi, CustomerApiError } from "../_shared/api-customer-runtime.ts";
import { readBoundedJson } from "../_shared/public-request-security.ts";
import { scaCanonicalPayload } from "../_shared/sca.ts";
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
} from "../_shared/public-api-v258/api-gateway.ts";
import {
  BridgeProviderError,
} from "../_shared/providers/bridge.ts";
import {
  validateOnboardingAuthorization,
  validateIdempotencyHeader,
  validateWebhookCreate,
} from "../_shared/public-api-v258/api-gateway-validators.ts";
import {
  allowedAccountTypes,
  resolveTenantOnboardingPolicy,
  sha256Hex as onboardingTokenHash,
  signOnboardingToken,
} from "../_shared/public-api-v258/onboarding-policy.ts";
import {
  evaluateApiRuntimeReleaseGate,
  readApiReleaseGateEnvironment,
} from "../_shared/public-api-v258/api-release-gates.ts";
import {
  TenantOwnershipError,
} from "../_shared/public-api-v258/api-tenant-ownership.ts";
import {
  ApiFinancialAuthorizationError,
} from "../_shared/public-api-v258/api-financial-authorization.ts";
import {
  encryptApiWebhookSecret,
  newApiWebhookSecret,
} from "../_shared/public-api-v258/api-webhook-security.ts";

const ROUTE_SCOPE_MAP: Record<string, string | null> = {
  ...CUSTOMER_API_SCOPES,
  "GET /v1/health": null,
  "POST /v1/customers": "customers:write",
  "POST /v1/onboarding-authorizations": "onboarding:write",
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
  "POST /v1/onboarding-authorizations",
  "POST /v1/wallets",
  "POST /v1/virtual-accounts",
  "POST /v1/transfers",
  "POST /v1/payouts",
  "POST /v1/webhooks",
  "POST /v1/external-accounts", "DELETE /v1/external-accounts",
  "POST /v1/external-wallets", "DELETE /v1/external-wallets",
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
    .gt("expires_at", new Date().toISOString())
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
  if (e instanceof CustomerApiError) return { status:e.status, body:{success:false,error:{code:e.code,message:e.message}} };
  if (e instanceof ApiFinancialAuthorizationError) {
    return { status: e.status, body: { success: false, error: { code: e.code, message: e.message } } };
  }
  if (e instanceof TenantOwnershipError) {
    return {
      status: e.status,
      body: {
        success: false,
        error: { code: e.code, message: e.message },
      },
    };
  }
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
    apiKeyId: string;
    tenantMetadata: Record<string, unknown>;
    maxSingleTransferUsd: string | null;
    idempotencyKey: string;
  },
): Promise<GatewayHandlerResult> {
  if (routeKey === "POST /v1/onboarding-authorizations") {
    const parsed = validateOnboardingAuthorization(body);
    if (!parsed.ok) return { status: 400, body: { success: false, error: parsed.error } };

    const policy = resolveTenantOnboardingPolicy(ctx.tenantMetadata);
    const tenantAllowed = allowedAccountTypes(policy, parsed.value.onboarding_channel);
    const allowed = parsed.value.requested_account_types
      ? parsed.value.requested_account_types.filter((type) => tenantAllowed.includes(type))
      : tenantAllowed;
    if (allowed.length === 0 || (parsed.value.requested_account_types && allowed.length !== parsed.value.requested_account_types.length)) {
      return {
        status: 403,
        body: {
          success: false,
          error: { code: "forbidden", message: "Requested account type is not enabled for this tenant" },
        },
      };
    }

    const secret = Deno.env.get("ONBOARDING_TOKEN_SIGNING_SECRET") ?? "";
    if (secret.length < 32) {
      return { status: 500, body: { success: false, error: { code: "internal_error", message: "Partner onboarding authorization is not configured" } } };
    }
    const release = parsed.value.onboarding_channel === "white_label" ? await loadPublishedWhiteLabel(supa,{tenantId:ctx.tenantId}) : null;
    if(parsed.value.onboarding_channel === "white_label" && !release) return {status:409,body:{success:false,error:{code:"customer_app_not_live",message:"Publish the approved customer app before issuing signup links"}}};
    const now = Math.floor(Date.now() / 1000);
    const authorizationId = crypto.randomUUID();
    const expiresAt = now + parsed.value.expires_in_seconds;
    const token = await signOnboardingToken({
      iss: "borderpay",
      aud: "partner_onboarding",
      jti: authorizationId,
      tenant_id: ctx.tenantId,
      api_key_id: ctx.apiKeyId,
      external_user_id: parsed.value.external_user_id,
      allowed_account_types: allowed,
      onboarding_channel: parsed.value.onboarding_channel,
      iat: now,
      exp: expiresAt,
    }, secret);
    const tokenHash = await onboardingTokenHash(token);
    const { error: insertError } = await supa.from("api_onboarding_authorizations").insert({
      id: authorizationId,
      tenant_id: ctx.tenantId,
      api_key_id: ctx.apiKeyId,
      token_hash: tokenHash,
      external_user_id: parsed.value.external_user_id,
      allowed_account_types: allowed,
      onboarding_channel: parsed.value.onboarding_channel,
      expires_at: new Date(expiresAt * 1000).toISOString(),
    });
    if (insertError) throw new Error(`Failed to persist onboarding authorization: ${insertError.message}`);
    const { error: auditError } = await supa.from("api_onboarding_audit").insert({
      tenant_id: ctx.tenantId,
      api_key_id: ctx.apiKeyId,
      authorization_id: authorizationId,
      external_user_id: parsed.value.external_user_id,
      event_type: "authorization_issued",
      onboarding_channel: parsed.value.onboarding_channel,
      metadata: { allowed_account_types: allowed, expires_in_seconds: parsed.value.expires_in_seconds },
    });
    if (auditError) {
      const { error: rollbackError } = await supa
        .from("api_onboarding_authorizations")
        .delete()
        .eq("id", authorizationId)
        .eq("tenant_id", ctx.tenantId);
      if (rollbackError) {
        console.error("onboarding authorization rollback failed", rollbackError.message);
      }
      throw new Error(`Failed to persist onboarding audit: ${auditError.message}`);
    }
    const appUrl = release?.brand.app_origin || (Deno.env.get("BORDERPAY_APP_URL") ?? "https://app.borderpayafrica.com").replace(/\/$/, "");
    return {
      status: 201,
      body: {
        success: true,
        data: {
          onboarding_token: token,
          expires_at: new Date(expiresAt * 1000).toISOString(),
          allowed_account_types: allowed,
          // Fragments are not sent in HTTP requests or access logs. The app
          // captures and immediately scrubs this short-lived bearer value.
          signup_url: `${appUrl}/signup#onboarding_token=${encodeURIComponent(token)}`,
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
    const endpointId = crypto.randomUUID();
    const secretVersion = 1;
    const plainSecret = newApiWebhookSecret();
    const signingSecretHash = await sha256Hex(plainSecret);
    const encrypted = await encryptApiWebhookSecret(
      plainSecret,
      endpointId,
      secretVersion,
    );

    const { data, error } = await supa
      .from("api_webhook_endpoints")
      .insert({
        id: endpointId,
        tenant_id: ctx.tenantId,
        endpoint_url: parsed.value.endpoint_url,
        signing_secret_hash: signingSecretHash,
        signing_secret_ciphertext: encrypted.ciphertext,
        signing_secret_nonce: encrypted.nonce,
        signing_secret_version: secretVersion,
        delivery_enabled: true,
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
        const parsed = await readBoundedJson<Record<string, unknown>>(req, 65_536);
        if (!parsed.ok) return gatewayError("invalid_request", parsed.error, parsed.status);
        body = parsed.value;
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

    if (req.method === "GET") body = Object.fromEntries(new URL(req.url).searchParams);
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

    const releaseGate = evaluateApiRuntimeReleaseGate(
      ctx.defaultMode,
      routeKey,
      readApiReleaseGateEnvironment(),
    );
    if (!releaseGate.allowed) {
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
        metadata: { reason: releaseGate.reason, route_key: routeKey },
      });
      return gatewayError(
        "forbidden",
        "This API operation is not enabled for the tenant environment",
        403,
        { reason: releaseGate.reason || "release_gate_denied" },
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
    const customerSession = CUSTOMER_API_SCOPES[routeKey]
      ? await authenticateApiCustomer(supa, tenantId, req.headers.get("X-BorderPay-Customer-Authorization") || "") : null;
    const isIdempotentRoute = IDEMPOTENT_ROUTES.has(routeKey);

    let idempotencyKey = req.headers.get("Idempotency-Key") || "";
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

      requestHash = await sha256Hex(scaCanonicalPayload("partner_api", { route_key:routeKey, customer_user_id:customerSession?.userId, body }));

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

      handlerResult = customerSession
        ? await handleCustomerApi(supa, routeKey, bodyWithFallbackIdempotency, {tenantId,apiKeyId,idempotencyKey,maxSingleTransferUsd:ctx.maxSingleTransferUsd,maxSingleTransferEur:typeof ctx.tenantMetadata.max_single_transfer_eur === "string" ? ctx.tenantMetadata.max_single_transfer_eur : null}, customerSession)
        : await handleRoute(
        supa,
        routeKey,
        bodyWithFallbackIdempotency,
        {
          tenantId,
          apiKeyId,
          tenantMetadata: ctx.tenantMetadata,
          maxSingleTransferUsd: ctx.maxSingleTransferUsd,
          idempotencyKey,
        },
      );
    } catch (e) {
      handlerResult = mapBridgeError(e);
    }

    if (isIdempotentRoute && handlerResult.status >= 200 && handlerResult.status < 300) {
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
    if (error instanceof CustomerApiError) { const result=mapBridgeError(error); return gatewayJson(result.body,result.status); }
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

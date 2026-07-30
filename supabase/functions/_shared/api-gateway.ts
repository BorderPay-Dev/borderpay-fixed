import { createClient } from "jsr:@supabase/supabase-js@2";

export type ApiGatewayErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_request"
  | "idempotency_key_required"
  | "idempotency_replay_mismatch"
  | "provider_unavailable"
  | "provider_error"
  | "rate_limited"
  | "not_found"
  | "not_implemented"
  | "internal_error";

export interface ApiGatewayContext {
  apiKeyId: string;
  tenantId: string;
  tenantName: string;
  defaultMode: "sandbox" | "production";
  rateLimitPerMinute: number;
  betaAccessEnabled: boolean;
  maxSingleTransferUsd: number | null;
  tenantMetadata: Record<string, unknown>;
  scopes: string[];
}

export const GATEWAY_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key, x-borderpay-route",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

export function gatewayJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...GATEWAY_CORS, "Content-Type": "application/json" },
  });
}

export function gatewayError(
  code: ApiGatewayErrorCode,
  message: string,
  status = 400,
  details?: Record<string, unknown>,
) {
  return gatewayJson(
    {
      success: false,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    status,
  );
}

export function parseBearerToken(req: Request): string {
  const auth = req.headers.get("Authorization") ?? "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

export function extractClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for")?.trim();
  if (xff) return xff.split(",")[0]?.trim() || null;

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return null;
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

export function createAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRole) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function resolveGatewayContext(
  supa: ReturnType<typeof createAdminClient>,
  rawApiKey: string,
): Promise<ApiGatewayContext | null> {
  const keyHash = await sha256Hex(rawApiKey);
  const { data, error } = await supa.rpc("api_gateway_resolve_api_key", {
    p_key_hash: keyHash,
  });
  if (error) {
    throw new Error(`api_gateway_resolve_api_key failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;

  return {
    apiKeyId: String(row.api_key_id),
    tenantId: String(row.tenant_id),
    tenantName: String(row.tenant_name),
    defaultMode: row.default_mode === "production" ? "production" : "sandbox",
    rateLimitPerMinute: Number(row.rate_limit_per_minute || 120),
    betaAccessEnabled: Boolean(row.beta_access_enabled),
    maxSingleTransferUsd: row.max_single_transfer_usd == null
      ? null
      : Number(row.max_single_transfer_usd),
    tenantMetadata: row.tenant_metadata && typeof row.tenant_metadata === "object"
      ? row.tenant_metadata as Record<string, unknown>
      : {},
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
  };
}

export async function checkIpAllowlist(
  supa: ReturnType<typeof createAdminClient>,
  tenantId: string,
  clientIp: string | null,
): Promise<boolean> {
  if (!clientIp) return false;
  const { data, error } = await supa.rpc("api_gateway_check_ip_allowlist", {
    p_tenant_id: tenantId,
    p_client_ip: clientIp,
  });
  if (error) {
    throw new Error(`api_gateway_check_ip_allowlist failed: ${error.message}`);
  }
  return Boolean(data);
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAt: string;
  currentCount: number;
}

export async function consumeRateLimit(
  supa: ReturnType<typeof createAdminClient>,
  tenantId: string,
  apiKeyId: string,
  limitPerMinute: number,
): Promise<RateLimitDecision> {
  const { data, error } = await supa.rpc("api_gateway_consume_rate_limit", {
    p_tenant_id: tenantId,
    p_api_key_id: apiKeyId,
    p_limit: limitPerMinute,
    p_window_seconds: 60,
  });

  if (error) {
    throw new Error(`api_gateway_consume_rate_limit failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date().toISOString(),
      currentCount: 0,
    };
  }

  return {
    allowed: Boolean(row.allowed),
    remaining: Number(row.remaining ?? 0),
    resetAt: String(row.reset_at ?? new Date().toISOString()),
    currentCount: Number(row.current_count ?? 0),
  };
}

export async function logGatewayRequest(
  supa: ReturnType<typeof createAdminClient>,
  params: {
    tenantId?: string | null;
    apiKeyId?: string | null;
    requestId?: string | null;
    method?: string | null;
    route?: string | null;
    statusCode?: number | null;
    errorCode?: string | null;
    clientIp?: string | null;
    latencyMs?: number | null;
    metadata?: Record<string, unknown>;
  },
) {
  const payload = {
    tenant_id: params.tenantId ?? null,
    api_key_id: params.apiKeyId ?? null,
    request_id: params.requestId ?? null,
    method: params.method ?? null,
    route: params.route ?? null,
    status_code: params.statusCode ?? null,
    error_code: params.errorCode ?? null,
    client_ip: params.clientIp ?? null,
    latency_ms: params.latencyMs ?? null,
    metadata: params.metadata ?? {},
  };

  const { error } = await supa.from("api_request_log").insert(payload);
  if (error) {
    console.error("api_request_log insert failed", error.message);
  }
}

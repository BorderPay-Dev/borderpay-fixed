/**
 * Flutterwave V4 OAuth client.
 *
 * Source of truth:
 * - https://developer.flutterwave.com/docs/authentication
 * - https://developer.flutterwave.com/docs/environments
 * - https://developer.flutterwave.com/docs/api-headers
 * - https://developer.flutterwave.com/docs/idempotency
 */

const PRODUCTION_BASE_URL = "https://f4bexperience.flutterwave.com";
const SANDBOX_BASE_URL = "https://developersandbox-api.flutterwave.com";
const TOKEN_URL = "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface FlutterwaveV4Result<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  providerErrorType?: string;
  providerErrorCode?: string;
  traceId: string;
  idempotencyCacheHit?: boolean;
}

export interface FlutterwaveV4Request {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  idempotencyKey?: string;
  traceId?: string;
  timeoutMs?: number;
}

type TokenCache = { accessToken: string; expiresAtMs: number };
let tokenCache: TokenCache | null = null;

function env(name: string): string {
  return String(Deno.env.get(name) || "").trim();
}

export function flutterwaveV4Configured(): boolean {
  return Boolean(env("FLW_CLIENT_ID") && env("FLW_CLIENT_SECRET") && env("FLW_ENCRYPTION_KEY"));
}

export function flutterwaveV4BaseUrl(): string {
  const configured = env("FLW_V4_BASE_URL");
  if (configured) return configured.replace(/\/+$/, "");
  return env("FLW_V4_ENVIRONMENT").toLowerCase() === "sandbox"
    ? SANDBOX_BASE_URL
    : PRODUCTION_BASE_URL;
}

export function newFlutterwaveTraceId(scope: string): string {
  const safeScope = String(scope || "request").replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 40);
  return `borderpay:flw:v4:${safeScope}:${crypto.randomUUID()}`;
}

function safeJson(raw: string): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function providerError(payload: any): { message: string; type?: string; code?: string } {
  const error = payload?.error && typeof payload.error === "object" ? payload.error : null;
  const message = String(error?.message || payload?.message || (typeof payload?.error === "string" ? payload.error : "") || "").trim();
  return {
    message,
    type: error?.type ? String(error.type) : undefined,
    code: error?.code ? String(error.code) : undefined,
  };
}

function normalizeError(status: number, payload: any): { error: string; type?: string; code?: string } {
  const provider = providerError(payload);
  const lowered = `${provider.type || ""} ${provider.message}`.toLowerCase();
  let error = "flutterwave_request_rejected";
  if (status === 401 || lowered.includes("unauthor")) error = "flutterwave_auth_error";
  else if (status === 403 && (lowered.includes("ip") || lowered.includes("allowlist") || lowered.includes("whitelist"))) {
    error = "flutterwave_ip_not_allowlisted";
  } else if (lowered.includes("inactive") || lowered.includes("disabled") || lowered.includes("not activated")) {
    error = "flutterwave_account_inactive";
  } else if (provider.type === "transfer_amount_below_limit") error = "flutterwave_amount_below_minimum";
  else if (provider.type === "transfer_amount_exceeds_limit") error = "flutterwave_amount_above_limit";
  else if (provider.type === "insufficient_balance") error = "flutterwave_insufficient_provider_balance";
  else if (provider.type === "invalid_bank_code") error = "flutterwave_invalid_bank_code";
  else if (provider.type === "rejected_recipient_merchant") error = "flutterwave_recipient_rejected";
  else if (status === 409) error = "flutterwave_conflict";
  else if (status === 429) error = "flutterwave_rate_limited";
  else if (status >= 500) error = "flutterwave_upstream_unavailable";
  return { error, type: provider.type, code: provider.code };
}

async function accessToken(timeoutMs: number): Promise<string> {
  if (tokenCache && tokenCache.expiresAtMs - Date.now() > 60_000) return tokenCache.accessToken;
  const clientId = env("FLW_CLIENT_ID");
  const clientSecret = env("FLW_CLIENT_SECRET");
  if (!clientId || !clientSecret || !env("FLW_ENCRYPTION_KEY")) throw new Error("flutterwave_not_configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  try {
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    });
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form.toString(),
      signal: controller.signal,
    });
    const payload = safeJson(await response.text());
    const token = String(payload?.access_token || "").trim();
    if (!response.ok || !token) throw new Error("flutterwave_auth_error");
    const expiresIn = Number(payload?.expires_in);
    tokenCache = {
      accessToken: token,
      expiresAtMs: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 600) * 1_000,
    };
    return token;
  } finally {
    clearTimeout(timeout);
  }
}

export async function flutterwaveV4Fetch<T = unknown>(request: FlutterwaveV4Request): Promise<FlutterwaveV4Result<T>> {
  const traceId = request.traceId || newFlutterwaveTraceId("api");
  if (!flutterwaveV4Configured()) return { ok: false, status: 503, data: null, error: "flutterwave_not_configured", traceId };
  const method = request.method || "GET";
  if (method === "POST" && (!request.idempotencyKey || request.idempotencyKey.length < 12)) {
    return { ok: false, status: 500, data: null, error: "flutterwave_idempotency_key_invalid", traceId };
  }
  const timeoutMs = Number.isFinite(request.timeoutMs) ? Number(request.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  try {
    const token = await accessToken(timeoutMs);
    const path = request.path.startsWith("/") ? request.path : `/${request.path}`;
    const url = new URL(`${flutterwaveV4BaseUrl()}${path}`);
    for (const [key, value] of Object.entries(request.query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "X-Trace-Id": traceId,
    };
    if (request.body !== undefined) headers["Content-Type"] = "application/json";
    if (request.idempotencyKey) headers["X-Idempotency-Key"] = request.idempotencyKey;
    const response = await fetch(url, {
      method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: controller.signal,
    });
    const payload = safeJson(await response.text()) as T | null;
    const cacheHit = response.headers.get("x-idempotency-cache-hit") === "true";
    if (!response.ok) {
      const normalized = normalizeError(response.status, payload);
      return {
        ok: false,
        status: response.status,
        data: payload,
        error: normalized.error,
        providerErrorType: normalized.type,
        providerErrorCode: normalized.code,
        traceId,
        idempotencyCacheHit: cacheHit,
      };
    }
    return { ok: true, status: response.status, data: payload, traceId, idempotencyCacheHit: cacheHit };
  } catch (error: any) {
    const code = error?.name === "AbortError" ? "flutterwave_timeout" : String(error?.message || "flutterwave_request_failed");
    return { ok: false, status: code === "flutterwave_timeout" ? 504 : 502, data: null, error: code, traceId };
  } finally {
    clearTimeout(timeout);
  }
}

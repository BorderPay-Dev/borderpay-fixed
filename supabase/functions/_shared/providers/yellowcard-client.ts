/**
 * Yellow Card HTTP client.
 *
 * Uses Yellow Card's HMAC auth scheme:
 * timestamp + request path + method + base64(sha256(body)) for write requests.
 */

const PRODUCTION_BASE_URL = "https://api.yellowcard.io/business";

function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = String(Deno.env.get(name) || "").trim();
    if (value) return value;
  }
  return "";
}

const PRODUCTION_ENABLED = ["1", "true", "yes", "on"].includes(
  firstEnv("YC_PRODUCTION_ENABLED").toLowerCase(),
);
const YC_API_KEY = firstEnv(
  "YC_PRODUCTION_API_KEY",
  "YELLOW_CARD_PRODUCTION_API_KEY",
  "YC_API_KEY",
  "YELLOW_CARD_API_KEY",
  "YELLOWCARD_API_KEY",
);
const YC_SECRET_KEY = firstEnv(
  "YC_PRODUCTION_SECRET_KEY",
  "YELLOW_CARD_PRODUCTION_SECRET_KEY",
  "YC_SECRET_KEY",
  "YELLOW_CARD_SECRET_KEY",
  "YELLOWCARD_SECRET_KEY",
);
const YC_BASE_URL = firstEnv("YC_PRODUCTION_BASE_URL", "YELLOW_CARD_PRODUCTION_BASE_URL") || PRODUCTION_BASE_URL;
const YC_EGRESS_RELAY_URL = firstEnv("YC_EGRESS_RELAY_URL");
const YC_EGRESS_RELAY_TOKEN = firstEnv("YC_EGRESS_RELAY_TOKEN");
const DEFAULT_TIMEOUT_MS = Number(firstEnv("YC_HTTP_TIMEOUT_MS", "YELLOW_CARD_HTTP_TIMEOUT_MS") || "15000");

export interface YellowCardFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  timeoutMs?: number;
}

export interface YellowCardFetchResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  rawText: string;
  requestId?: string;
  error?: string;
}

export function getYellowCardConfig() {
  const baseUrl = YC_BASE_URL.replace(/\/+$/, "");
  return {
    configured: Boolean(PRODUCTION_ENABLED && YC_API_KEY && YC_SECRET_KEY),
    base_url: baseUrl,
    environment: "production",
    transport: YC_EGRESS_RELAY_URL ? "restricted_egress_relay" : "direct",
    production_enabled: PRODUCTION_ENABLED,
    key_prefix: YC_API_KEY ? `${YC_API_KEY.slice(0, 6)}...` : null,
  };
}

export function getYellowCardWebhookCredentials() {
  return { apiKey: YC_API_KEY, secretKey: YC_SECRET_KEY };
}

function buildUrl(path: string, query?: YellowCardFetchOptions["query"]): URL {
  const base = YC_BASE_URL.replace(/\/+$/, "");
  const url = new URL(path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function toBase64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function sha256Base64(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toBase64(digest);
}

async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toBase64(sig);
}

function parseJson(raw: string): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function yellowCardFetch<T = unknown>(
  opts: YellowCardFetchOptions,
): Promise<YellowCardFetchResult<T>> {
  if (!PRODUCTION_ENABLED || !YC_API_KEY || !YC_SECRET_KEY) {
    return {
      ok: false,
      status: 503,
      data: null,
      rawText: "",
      error: "yellow_card_not_configured",
    };
  }

  const method = opts.method || "GET";
  const bodyText = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const url = buildUrl(opts.path, opts.query);
  const timestamp = new Date().toISOString();
  const bodyHash = method === "POST" || method === "PUT" ? await sha256Base64(bodyText) : "";
  const message = `${timestamp}${url.pathname}${method}${bodyHash}`;
  const signature = await hmacSha256Base64(YC_SECRET_KEY, message);
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));

  try {
    if (PRODUCTION_ENABLED && (!YC_EGRESS_RELAY_URL || !YC_EGRESS_RELAY_TOKEN)) {
      return {
        ok: false,
        status: 503,
        data: null,
        rawText: "",
        error: "yellow_card_production_relay_not_configured",
      };
    }
    const useRelay = PRODUCTION_ENABLED && Boolean(YC_EGRESS_RELAY_URL && YC_EGRESS_RELAY_TOKEN);
    const requestUrl = useRelay ? YC_EGRESS_RELAY_URL : url.toString();
    const requestMethod = useRelay ? "POST" : method;
    const requestBody = useRelay
      ? JSON.stringify({
        method,
        path: opts.path.startsWith("/") ? opts.path : `/${opts.path}`,
        query: opts.query || {},
        ...(opts.body === undefined ? {} : { body: opts.body }),
        timeout_ms: timeoutMs,
      })
      : bodyText || undefined;
    const res = await fetch(requestUrl, {
      method: requestMethod,
      headers: useRelay
        ? {
          "Accept": "application/json",
          "Authorization": `Bearer ${YC_EGRESS_RELAY_TOKEN}`,
          "Content-Type": "application/json",
          "X-BorderPay-YC-Authorization": `YcHmacV1 ${YC_API_KEY}:${signature}`,
          "X-BorderPay-YC-Timestamp": timestamp,
        }
        : {
          "Accept": "application/json",
          "Authorization": `YcHmacV1 ${YC_API_KEY}:${signature}`,
          "X-YC-Timestamp": timestamp,
          ...(bodyText ? { "Content-Type": "application/json" } : {}),
        },
      body: requestBody,
      signal: controller.signal,
    });
    const rawText = await res.text();
    const parsed = parseJson(rawText) as T | null;
    const requestId = res.headers.get("x-request-id") || res.headers.get("x-correlation-id") || undefined;
    if (!res.ok) {
      const payload = parsed as Record<string, unknown> | null;
      const message =
        (typeof payload?.message === "string" && payload.message) ||
        (typeof payload?.error === "string" && payload.error) ||
        `Yellow Card HTTP ${res.status}`;
      const lowered = String(message || "").toLowerCase();
      const normalized =
        res.status === 401 || lowered.includes("auth") || lowered.includes("signature")
          ? "yellow_card_auth_error"
          : res.status === 403 || lowered.includes("whitelist") || lowered.includes("allowlist")
            ? "yellow_card_forbidden_or_ip_not_allowlisted"
            : res.status === 429
              ? "yellow_card_rate_limited"
              : res.status >= 500
                ? "yellow_card_upstream_unavailable"
                : message;
      return { ok: false, status: res.status, data: parsed, rawText, requestId, error: normalized };
    }
    return { ok: true, status: res.status, data: parsed, rawText, requestId };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { ok: false, status: 504, data: null, rawText: "", error: "yellow_card_timeout" };
    }
    return { ok: false, status: 502, data: null, rawText: "", error: String(err?.message || "yellow_card_request_failed") };
  } finally {
    clearTimeout(timeout);
  }
}

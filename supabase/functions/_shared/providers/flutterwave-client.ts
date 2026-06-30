/**
 * Flutterwave HTTP client (Deno).
 *
 * Backend-only scaffolding:
 * - Adds Authorization header from FLW_SECRET_KEY
 * - Supports idempotency key forwarding
 * - Normalizes JSON / error payloads
 * - No product logic in this layer
 */

const FLW_BASE_URL = (Deno.env.get("FLW_BASE_URL") || "https://api.flutterwave.com").replace(/\/+$/, "");
const FLW_SECRET_KEY = Deno.env.get("FLW_SECRET_KEY") || "";
const DEFAULT_TIMEOUT_MS = Number(Deno.env.get("FLW_HTTP_TIMEOUT_MS") || "15000");

export interface FlutterwaveFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  idempotencyKey?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface FlutterwaveFetchResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  rawText: string;
  requestId?: string;
  error?: string;
}

function buildUrl(path: string, query?: FlutterwaveFetchOptions["query"]): string {
  const url = new URL(path.startsWith("http") ? path : `${FLW_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function parseJson(raw: string): any {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function flutterwaveClientConfigured(): boolean {
  return Boolean(FLW_SECRET_KEY);
}

export async function flutterwaveFetch<T = unknown>(
  opts: FlutterwaveFetchOptions,
): Promise<FlutterwaveFetchResult<T>> {
  if (!FLW_SECRET_KEY) {
    return {
      ok: false,
      status: 503,
      data: null,
      rawText: "",
      error: "flutterwave_not_configured",
    };
  }

  const method = opts.method || "GET";
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));

  try {
    const url = buildUrl(opts.path, opts.query);
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${FLW_SECRET_KEY}`,
      "Accept": "application/json",
      ...opts.headers,
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.idempotencyKey) {
      // Flutterwave docs emphasize idempotency for transfer safety.
      // Send both header variants to stay compatible across endpoint families.
      headers["Idempotency-Key"] = opts.idempotencyKey;
      headers["X-Idempotency-Key"] = opts.idempotencyKey;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });

    const rawText = await res.text();
    const parsed = parseJson(rawText) as T | null;
    const requestId = res.headers.get("x-request-id") || res.headers.get("x-flw-request-id") || undefined;

    if (!res.ok) {
      const payload = parsed as Record<string, unknown> | null;
      const msg =
        (typeof payload?.message === "string" && payload.message) ||
        (typeof payload?.error === "string" && payload.error) ||
        `Flutterwave HTTP ${res.status}`;
      const normalized =
        res.status === 429 ? "flutterwave_rate_limited" :
        res.status >= 500 ? "flutterwave_upstream_unavailable" :
        msg;
      return { ok: false, status: res.status, data: parsed, rawText, requestId, error: normalized };
      
    }

    return { ok: true, status: res.status, data: parsed, rawText, requestId };
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return { ok: false, status: 504, data: null, rawText: "", error: "flutterwave_timeout" };
    }
    return { ok: false, status: 502, data: null, rawText: "", error: String(e?.message || "flutterwave_request_failed") };
  } finally {
    clearTimeout(timeout);
  }
}

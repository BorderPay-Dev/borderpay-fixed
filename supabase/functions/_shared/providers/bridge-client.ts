/**
 * Bridge HTTP client (Deno).
 *
 *   • API key auth via the `Api-Key` header
 *   • Idempotency-Key on every POST
 *   • 4-attempt exponential backoff on 5xx + network failures
 *   • Request/response logging hook (so we can wire to email_log-style table later)
 */

const BRIDGE_BASE_URL = Deno.env.get("BRIDGE_BASE_URL")?.replace(/\/+$/, "") ?? "https://api.bridge.xyz";
const BRIDGE_API_KEY  = Deno.env.get("BRIDGE_API_KEY") ?? "";

export interface BridgeFetchOptions {
  method:       "GET" | "POST" | "PUT" | "DELETE";
  path:         string;                     // e.g. "/v0/customers"
  query?:       Record<string, string | number | boolean | undefined>;
  body?:        unknown;
  idempotencyKey?: string;                  // required for POST per Bridge docs
  retryable?:   boolean;
}

export interface BridgeResponse<T = unknown> {
  ok:        boolean;
  status:    number;
  data:      T | null;
  raw_text:  string;
  error?:    string;
  request_id?: string;
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

function buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL((path.startsWith("http") ? path : `${BRIDGE_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`));
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function bridgeFetch<T = unknown>(opts: BridgeFetchOptions): Promise<BridgeResponse<T>> {
  if (!BRIDGE_API_KEY) {
    return { ok: false, status: 0, data: null, raw_text: "", error: "BRIDGE_API_KEY missing" };
  }
  const url = buildUrl(opts.path, opts.query);
  const headers: Record<string, string> = {
    "Api-Key":      BRIDGE_API_KEY,
    "Accept":       "application/json",
    "User-Agent":   "borderpay-edge/1.0",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  // Bridge requires Idempotency-Key on POST/PUT. If caller didn't pass one,
  // mint a deterministic-ish one from path + body.
  if ((opts.method === "POST" || opts.method === "PUT") && !opts.idempotencyKey) {
    opts.idempotencyKey = crypto.randomUUID();
  }
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method:  opts.method,
        headers,
        body:    opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const text = await res.text();
      let parsed: unknown = null;
      if (text.length) { try { parsed = JSON.parse(text); } catch { /* leave raw */ } }
      const requestId = res.headers.get("x-request-id") || res.headers.get("request-id") || undefined;

      if (res.ok) {
        return { ok: true, status: res.status, data: parsed as T, raw_text: text, request_id: requestId };
      }

      const errorMsg =
        (parsed && typeof parsed === "object" && "message" in parsed && typeof (parsed as any).message === "string"
          ? (parsed as any).message
          : `HTTP ${res.status}`);

      lastErr = errorMsg;

      // Retry on retryable codes; otherwise return immediately.
      if (!RETRYABLE_STATUSES.has(res.status) || opts.retryable === false || attempt === MAX_ATTEMPTS) {
        return { ok: false, status: res.status, data: parsed as T, raw_text: text, error: errorMsg, request_id: requestId };
      }
    } catch (e) {
      lastErr = (e as Error).message;
      if (attempt === MAX_ATTEMPTS) {
        return { ok: false, status: 0, data: null, raw_text: "", error: lastErr };
      }
    }
    const backoffMs = Math.min(8000, 500 * Math.pow(2, attempt - 1));
    await new Promise(r => setTimeout(r, backoffMs));
  }
  return { ok: false, status: 0, data: null, raw_text: "", error: lastErr };
}

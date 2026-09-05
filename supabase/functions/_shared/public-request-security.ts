const DEFAULT_MAX_JSON_BYTES = 16 * 1024;

export type JsonEnvelopeResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; error: string };

/** Prefer the caller address supplied by Supabase/Cloudflare ingress. */
export function extractPublicClientIp(req: Request): string | null {
  const cloudflareIp = req.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp;
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = req.headers.get("x-forwarded-for")?.trim();
  return forwarded?.split(",")[0]?.trim() || null;
}

export async function readBoundedJson<T>(
  req: Request,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<JsonEnvelopeResult<T>> {
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return { ok: false, status: 415, code: "unsupported_media_type", error: "Content-Type must be application/json." };
  }
  const declaredLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, status: 413, code: "payload_too_large", error: "Request body is too large." };
  }
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    return { ok: false, status: 413, code: "payload_too_large", error: "Request body is too large." };
  }
  try {
    const value = JSON.parse(raw) as T;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return { ok: true, value };
  } catch {
    return { ok: false, status: 400, code: "invalid_json", error: "Invalid JSON request body." };
  }
}

export function captchaIsRequired(): boolean {
  return (Deno.env.get("SIGNUP_CAPTCHA_REQUIRED") || "").trim().toLowerCase() === "true";
}

/**
 * BorderPay webhook verifier helper (Node/Web Crypto compatible).
 *
 * Canonical payload to sign/verify:
 *   `${timestamp}.${rawBody}`
 *
 * Signature header format (recommended):
 *   x-borderpay-signature: sha256=<hex>
 *   x-borderpay-timestamp: <unix_seconds>
 */

export interface VerifyWebhookInput {
  rawBody: string;
  timestamp: string;
  signatureHeader: string;
  signingSecret: string;
  toleranceSeconds?: number;
  nowUnixSeconds?: number;
}

export interface VerifyWebhookResult {
  valid: boolean;
  reason?: "missing_header" | "invalid_timestamp" | "timestamp_out_of_window" | "signature_mismatch";
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeSignature(signatureHeader: string): string | null {
  const raw = signatureHeader.trim();
  if (!raw) return null;
  if (raw.startsWith("sha256=")) return raw.slice("sha256=".length).trim().toLowerCase();
  return raw.toLowerCase();
}

export async function verifyBorderPayWebhook(input: VerifyWebhookInput): Promise<VerifyWebhookResult> {
  const tolerance = input.toleranceSeconds ?? 300;
  const now = input.nowUnixSeconds ?? Math.floor(Date.now() / 1000);

  const signature = normalizeSignature(input.signatureHeader);
  if (!signature) return { valid: false, reason: "missing_header" };

  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return { valid: false, reason: "invalid_timestamp" };

  if (Math.abs(now - ts) > tolerance) {
    return { valid: false, reason: "timestamp_out_of_window" };
  }

  const payload = `${input.timestamp}.${input.rawBody}`;
  const expected = await hmacSha256Hex(input.signingSecret, payload);
  if (!constantTimeEqualHex(expected, signature)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  return { valid: true };
}

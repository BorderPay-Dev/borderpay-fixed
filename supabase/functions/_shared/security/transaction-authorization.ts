import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Method = "pin" | "biometric";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function secret(): string {
  return String(Deno.env.get("TRANSACTION_AUTH_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
}

function encode(value: Uint8Array): string {
  let binary = "";
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signature(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return encode(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

export async function issueTransactionAuthorization(userId: string, method: Method): Promise<string> {
  if (!secret()) throw new Error("transaction_authorization_unavailable");
  const payload = encode(encoder.encode(JSON.stringify({
    sub: userId,
    method,
    scope: "yellow_card_sandbox_transaction",
    exp: Math.floor(Date.now() / 1000) + 120,
    nonce: crypto.randomUUID(),
  })));
  return `${payload}.${await signature(payload)}`;
}

export async function verifyTransactionAuthorization(token: unknown, userId: string): Promise<{ valid: boolean; method?: Method }> {
  const [payload, provided] = String(token || "").split(".");
  if (!payload || !provided || !secret()) return { valid: false };
  const expected = await signature(payload);
  if (provided.length !== expected.length) return { valid: false };
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  if (mismatch !== 0) return { valid: false };
  try {
    const claims = JSON.parse(decoder.decode(decode(payload)));
    const valid = claims?.sub === userId &&
      claims?.scope === "yellow_card_sandbox_transaction" &&
      ["pin", "biometric"].includes(claims?.method) &&
      Number(claims?.exp) >= Math.floor(Date.now() / 1000);
    return valid ? { valid: true, method: claims.method } : { valid: false };
  } catch {
    return { valid: false };
  }
}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_BYTES = 32;
const PBKDF2_SALT_BYTES = 32;
const PIN_HASH_V2_PREFIX = "v2$";

export async function hashLegacyPin(pin: string, userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + userId);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derivePbkdf2Sha256(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
    },
    key,
    PBKDF2_KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function derivePinHashV2(pin: string, salt?: Uint8Array): Promise<string> {
  const saltBytes = salt ?? crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const hashBytes = await derivePbkdf2Sha256(pin, saltBytes);
  return `${PIN_HASH_V2_PREFIX}${bytesToB64(saltBytes)}$${bytesToB64(hashBytes)}`;
}

export function parsePinHashV2(hash: string): { salt: Uint8Array; hashB64: string } | null {
  if (typeof hash !== "string" || !hash.startsWith(PIN_HASH_V2_PREFIX)) return null;
  const parts = hash.split("$");
  if (parts.length !== 3 || parts[0] !== "v2" || !parts[1] || !parts[2]) return null;
  try {
    return { salt: b64ToBytes(parts[1]), hashB64: parts[2] };
  } catch {
    return null;
  }
}

export async function derivePinHashV2FromStored(pin: string, storedHash: string): Promise<string | null> {
  const parsed = parsePinHashV2(storedHash);
  if (!parsed) return null;
  return derivePinHashV2(pin, parsed.salt);
}

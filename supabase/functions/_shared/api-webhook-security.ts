const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class ApiWebhookSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiWebhookSecurityError";
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.trim().replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    throw new ApiWebhookSecurityError("Webhook encryption key is not valid base64");
  }
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer as ArrayBuffer;
}

async function importEncryptionKey(encodedKey: string): Promise<CryptoKey> {
  const bytes = base64ToBytes(encodedKey);
  if (bytes.byteLength !== 32) throw new ApiWebhookSecurityError("Webhook encryption key must contain exactly 32 bytes");
  return await crypto.subtle.importKey("raw", asArrayBuffer(bytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function secretAad(endpointId: string, version: number): Uint8Array {
  if (!endpointId || !Number.isInteger(version) || version < 1) throw new ApiWebhookSecurityError("Endpoint identity and secret version are required");
  return encoder.encode(`borderpay:api-webhook:${endpointId}:v${version}`);
}

export function readApiWebhookEncryptionKey(): string {
  const value = Deno.env.get("API_WEBHOOK_ENCRYPTION_KEY")?.trim() ?? "";
  if (!value) throw new ApiWebhookSecurityError("API webhook encryption is not configured");
  return value;
}

export async function encryptApiWebhookSecret(secret: string, endpointId: string, version: number, encodedKey = readApiWebhookEncryptionKey()): Promise<{ ciphertext: string; nonce: string }> {
  if (!secret) throw new ApiWebhookSecurityError("Webhook signing secret is required");
  const key = await importEncryptionKey(encodedKey);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asArrayBuffer(nonce), additionalData: asArrayBuffer(secretAad(endpointId, version)) }, key, encoder.encode(secret));
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), nonce: bytesToBase64(nonce) };
}

export async function decryptApiWebhookSecret(ciphertext: string, nonce: string, endpointId: string, version: number, encodedKey = readApiWebhookEncryptionKey()): Promise<string> {
  try {
    const key = await importEncryptionKey(encodedKey);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: asArrayBuffer(base64ToBytes(nonce)), additionalData: asArrayBuffer(secretAad(endpointId, version)) }, key, asArrayBuffer(base64ToBytes(ciphertext)));
    const secret = decoder.decode(plaintext);
    if (!secret) throw new Error("empty plaintext");
    return secret;
  } catch (error) {
    if (error instanceof ApiWebhookSecurityError) throw error;
    throw new ApiWebhookSecurityError("Webhook signing secret could not be decrypted");
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signApiWebhookPayload(secret: string, timestamp: string, body: string): Promise<string> {
  if (!secret || !/^\d{10,}$/.test(timestamp)) throw new ApiWebhookSecurityError("Webhook signing inputs are invalid");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  const hex = Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `v1=${hex}`;
}

export function validateApiWebhookEndpointUrl(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value.trim()); } catch { throw new ApiWebhookSecurityError("Webhook endpoint must be a valid HTTPS URL"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new ApiWebhookSecurityError("Webhook endpoint must use HTTPS without embedded credentials");
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || !host.includes(".")) {
    throw new ApiWebhookSecurityError("Webhook endpoint host is not allowed");
  }
  parsed.hash = "";
  return parsed.toString();
}

export function newApiWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `bwhsec_${bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

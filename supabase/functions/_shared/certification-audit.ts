const encoder = new TextEncoder();

export type SinkReceipt = {
  receipt_id: string;
  event_id: string;
  sequence_no: number;
  event_hash: string;
  stored_at: string;
  retention_until: string;
  object_lock_mode: "COMPLIANCE";
  key_id: string;
  signature: string;
};

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
}

export function receiptPayload(receipt: Omit<SinkReceipt, "signature">): string {
  return stableStringify(receipt);
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}

export async function verifySinkReceipt(
  receipt: SinkReceipt,
  expected: { event_id: string; sequence_no: number; event_hash: string; key_id: string },
  publicKeyBase64: string,
  minimumRetentionDays: number,
  now = new Date(),
): Promise<void> {
  if (!receipt || receipt.object_lock_mode !== "COMPLIANCE") throw new Error("sink did not confirm COMPLIANCE object lock");
  if (receipt.event_id !== expected.event_id || receipt.sequence_no !== expected.sequence_no || receipt.event_hash !== expected.event_hash) {
    throw new Error("sink receipt does not match audit event");
  }
  if (receipt.key_id !== expected.key_id) throw new Error("sink receipt key id mismatch");
  if (!receipt.receipt_id || !receipt.signature) throw new Error("sink receipt is incomplete");
  const storedAt = new Date(receipt.stored_at);
  const retentionUntil = new Date(receipt.retention_until);
  if (!Number.isFinite(storedAt.getTime()) || !Number.isFinite(retentionUntil.getTime())) throw new Error("sink receipt timestamp is invalid");
  const minimumRetention = new Date(now.getTime() + minimumRetentionDays * 86_400_000);
  if (retentionUntil < minimumRetention) throw new Error("sink receipt retention window is too short");

  const { signature: _signature, ...unsigned } = receipt;
  const key = await crypto.subtle.importKey("raw", decodeBase64(publicKeyBase64), { name: "Ed25519" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("Ed25519", key, decodeBase64(receipt.signature), encoder.encode(receiptPayload(unsigned)));
  if (!valid) throw new Error("sink receipt signature is invalid");
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

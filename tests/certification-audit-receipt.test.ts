import { receiptPayload, verifySinkReceipt, type SinkReceipt } from "../supabase/functions/_shared/certification-audit.ts";

async function assertRejects(action: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error && error.message.includes(message)) return;
    throw error;
  }
  throw new Error(`expected rejection containing: ${message}`);
}

function base64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

Deno.test("external audit receipt verifies only with the pinned signer and correlated event", async () => {
  const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as CryptoKeyPair;
  const now = new Date("2026-08-22T10:00:00Z");
  const unsigned: Omit<SinkReceipt, "signature"> = {
    receipt_id: "receipt-live-001",
    event_id: "11111111-1111-4111-8111-111111111111",
    sequence_no: 17,
    event_hash: "a".repeat(64),
    stored_at: "2026-08-22T10:00:00Z",
    retention_until: "2026-09-22T10:00:00Z",
    object_lock_mode: "COMPLIANCE",
    key_id: "audit-sink-2026-01",
  };
  const signature = await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(receiptPayload(unsigned)));
  const receipt: SinkReceipt = { ...unsigned, signature: base64(signature) };
  const publicKey = base64(await crypto.subtle.exportKey("raw", keys.publicKey));
  await verifySinkReceipt(receipt, {
    event_id: unsigned.event_id,
    sequence_no: unsigned.sequence_no,
    event_hash: unsigned.event_hash,
    key_id: unsigned.key_id,
  }, publicKey, 30, now);
  await assertRejects(() => verifySinkReceipt(receipt, {
    event_id: "22222222-2222-4222-8222-222222222222",
    sequence_no: unsigned.sequence_no,
    event_hash: unsigned.event_hash,
    key_id: unsigned.key_id,
  }, publicKey, 30, now), "does not match");
});

Deno.test("external audit receipt rejects insufficient immutable retention", async () => {
  const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as CryptoKeyPair;
  const unsigned: Omit<SinkReceipt, "signature"> = {
    receipt_id: "receipt-live-002",
    event_id: "11111111-1111-4111-8111-111111111111",
    sequence_no: 18,
    event_hash: "b".repeat(64),
    stored_at: "2026-08-22T10:00:00Z",
    retention_until: "2026-08-23T10:00:00Z",
    object_lock_mode: "COMPLIANCE",
    key_id: "audit-sink-2026-01",
  };
  const signature = await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(receiptPayload(unsigned)));
  const receipt: SinkReceipt = { ...unsigned, signature: base64(signature) };
  const publicKey = base64(await crypto.subtle.exportKey("raw", keys.publicKey));
  await assertRejects(() => verifySinkReceipt(receipt, {
    event_id: unsigned.event_id,
    sequence_no: unsigned.sequence_no,
    event_hash: unsigned.event_hash,
    key_id: unsigned.key_id,
  }, publicKey, 30, new Date("2026-08-22T10:00:00Z")), "too short");
});

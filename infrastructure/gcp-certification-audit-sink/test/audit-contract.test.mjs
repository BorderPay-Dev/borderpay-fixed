import assert from "node:assert/strict";
import { createHash, createHmac, generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import {
  createSignedReceipt,
  rawPublicKeyBase64,
  requireLockedRetention,
  stableStringify,
  validateEnvelope,
  verifyAuthorization,
} from "../audit-contract.mjs";

function fixture() {
  const payload = {
    sequence_no: 7,
    event_id: "11111111-1111-4111-8111-111111111111",
    occurred_at: "2026-08-22T10:00:00.000000Z",
    schema_name: "certification",
    table_name: "control",
    operation: "MARKER",
    record_key: "22222222-2222-4222-8222-222222222222",
    changed_fields: ["START"],
    actor: { current_user: "service_role" },
    old_values: null,
    new_values: { marker_kind: "START" },
  };
  const chainPayload = JSON.stringify(payload);
  const previousHash = "0".repeat(64);
  return {
    schema_version: 1,
    project_ref: "orwrcpwsffjlvzuraxjc",
    event: {
      ...payload,
      chain_payload: chainPayload,
      previous_hash: previousHash,
      event_hash: createHash("sha256").update(previousHash + chainPayload).digest("hex"),
    },
  };
}

test("delivery requires both bearer token and exact-body HMAC", () => {
  const raw = Buffer.from(stableStringify(fixture()));
  const signature = createHmac("sha256", "hmac-secret").update(raw).digest("hex");
  assert.doesNotThrow(() => verifyAuthorization({
    authorization: "Bearer bearer-secret",
    "x-borderpay-audit-signature": `sha256=${signature}`,
  }, raw, { bearerToken: "bearer-secret", hmacSecret: "hmac-secret" }));
  assert.throws(() => verifyAuthorization({
    authorization: "Bearer bearer-secret",
    "x-borderpay-audit-signature": `sha256=${signature}`,
  }, Buffer.concat([raw, Buffer.from(" ")]), { bearerToken: "bearer-secret", hmacSecret: "hmac-secret" }), /unauthorized/);
});

test("event hash, identity, and secret exclusion fail closed", () => {
  const envelope = fixture();
  assert.equal(validateEnvelope(envelope, envelope.event.event_id), envelope.event);
  assert.throws(() => validateEnvelope({ ...envelope, event: { ...envelope.event, event_hash: "a".repeat(64) } }, envelope.event.event_id), /hash mismatch/);
  assert.throws(() => validateEnvelope({ ...envelope, event: { ...envelope.event, new_values: { pin_hash: "secret" } } }, envelope.event.event_id), /forbidden/);
});

test("locked retention and Ed25519 receipt are verifiable", () => {
  assert.equal(requireLockedRetention({ retentionPolicy: { isLocked: true, retentionPeriod: String(30 * 86_400) } }, 30), 30 * 86_400);
  assert.throws(() => requireLockedRetention({ retentionPolicy: { isLocked: false, retentionPeriod: String(30 * 86_400) } }, 30), /not irreversibly locked/);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const event = fixture().event;
  const receipt = createSignedReceipt({
    event,
    bucketName: "audit-bucket",
    keyId: "audit-key-2026-01",
    storedAt: "2026-08-22T10:00:00.000Z",
    retentionUntil: "2026-09-21T10:00:00.000Z",
    privateKey,
  });
  const { signature, ...unsigned } = receipt;
  assert.equal(verify(null, Buffer.from(stableStringify(unsigned)), publicKey, Buffer.from(signature, "base64")), true);
  assert.equal(Buffer.from(rawPublicKeyBase64(privateKey), "base64").length, 32);
});

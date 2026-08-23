import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign,
  timingSafeEqual,
} from "node:crypto";

const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_KEYS = new Set([
  "encrypted_password",
  "confirmation_token",
  "recovery_token",
  "pin_hash",
  "pin_hash_v2",
  "totp_secret",
  "totp_secret_b64",
]);

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function containsForbiddenKey(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEYS.has(key) || containsForbiddenKey(child));
}

export function verifyAuthorization(headers, rawBody, { bearerToken, hmacSecret }) {
  const authorization = headers.authorization || "";
  const suppliedBearer = authorization.replace(/^Bearer\s+/i, "");
  const suppliedSignature = (headers["x-borderpay-audit-signature"] || "").replace(/^sha256=/, "");
  const expectedSignature = createHmac("sha256", hmacSecret).update(rawBody).digest("hex");
  const bearerValid = suppliedBearer.length === bearerToken.length
    && timingSafeEqual(Buffer.from(suppliedBearer), Buffer.from(bearerToken));
  const signatureValid = suppliedSignature.length === expectedSignature.length
    && timingSafeEqual(Buffer.from(suppliedSignature), Buffer.from(expectedSignature));
  if (!bearerValid || !signatureValid) throw new Error("unauthorized audit delivery");
}

export function validateEnvelope(envelope, eventHeader) {
  if (!envelope || envelope.schema_version !== 1 || typeof envelope.project_ref !== "string") {
    throw new Error("invalid audit envelope");
  }
  const event = envelope.event;
  if (!event || !UUID.test(event.event_id) || event.event_id !== eventHeader) {
    throw new Error("audit event identity mismatch");
  }
  if (!Number.isSafeInteger(Number(event.sequence_no)) || Number(event.sequence_no) < 1) {
    throw new Error("invalid audit sequence");
  }
  if (!SHA256.test(event.previous_hash) || !SHA256.test(event.event_hash) || typeof event.chain_payload !== "string") {
    throw new Error("invalid audit chain fields");
  }
  const calculated = createHash("sha256").update(event.previous_hash + event.chain_payload).digest("hex");
  if (calculated !== event.event_hash) throw new Error("audit event hash mismatch");
  if (containsForbiddenKey(event)) throw new Error("audit event contains forbidden secret material");
  return event;
}

export function privateKeyFromBase64(privateKeyBase64) {
  return createPrivateKey({
    key: Buffer.from(privateKeyBase64, "base64"),
    format: "der",
    type: "pkcs8",
  });
}

export function rawPublicKeyBase64(privateKey) {
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return spki.subarray(spki.length - 32).toString("base64");
}

export function createSignedReceipt({ event, bucketName, keyId, storedAt, retentionUntil, privateKey }) {
  const unsigned = {
    receipt_id: `gcs:${bucketName}:${event.event_id}`,
    event_id: event.event_id,
    sequence_no: Number(event.sequence_no),
    event_hash: event.event_hash,
    stored_at: storedAt,
    retention_until: retentionUntil,
    object_lock_mode: "COMPLIANCE",
    key_id: keyId,
  };
  return {
    ...unsigned,
    signature: sign(null, Buffer.from(stableStringify(unsigned)), privateKey).toString("base64"),
  };
}

export function requireLockedRetention(bucketMetadata, minimumDays) {
  const policy = bucketMetadata?.retentionPolicy;
  const seconds = Number(policy?.retentionPeriod);
  if (policy?.isLocked !== true || !Number.isFinite(seconds) || seconds < minimumDays * 86_400) {
    throw new Error("bucket retention policy is not irreversibly locked for the required period");
  }
  return seconds;
}

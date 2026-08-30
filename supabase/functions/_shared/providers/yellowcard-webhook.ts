export type YellowCardWebhookPayload = {
  id?: unknown;
  sequenceId?: unknown;
  status?: unknown;
  apiKey?: unknown;
  event?: unknown;
  errorCode?: unknown;
  sessionId?: unknown;
  executedAt?: unknown;
  [key: string]: unknown;
};

function base64Bytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value.trim());
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export async function verifyYellowCardWebhookSignature(
  rawBody: string,
  signature: string,
  secretKey: string,
): Promise<boolean> {
  const signatureBytes = base64Bytes(signature);
  if (!rawBody || !signatureBytes || !secretKey) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes.buffer.slice(
      signatureBytes.byteOffset,
      signatureBytes.byteOffset + signatureBytes.byteLength,
    ) as ArrayBuffer,
    new TextEncoder().encode(rawBody),
  );
}

export function parseYellowCardWebhook(rawBody: string): YellowCardWebhookPayload {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Error("yellow_card_webhook_invalid_json");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("yellow_card_webhook_invalid_payload");
  }
  return payload as YellowCardWebhookPayload;
}

export function normalizeYellowCardWebhook(payload: YellowCardWebhookPayload) {
  const event = String(payload.event ?? "").trim().toUpperCase();
  const sequenceId = String(payload.sequenceId ?? "").trim();
  const apiKey = String(payload.apiKey ?? "").trim();
  const explicitStatus = String(payload.status ?? "").trim().toLowerCase();
  const eventParts = event.split(".");
  const prefix = eventParts[0] ?? "";
  const eventStatus = eventParts.slice(1).join("_").toLowerCase();
  const status = explicitStatus || eventStatus;
  const direction = ["RECEIVE", "COLLECTION"].includes(prefix)
    ? "receive"
    : ["SEND", "PAYMENT"].includes(prefix) ? "payout" : null;
  // Current v2 settlement events are genuine signed Yellow Card callbacks,
  // but they do not have a one-to-one lifecycle mapping to our Receive/Send
  // transaction rows. Preserve them as evidence and acknowledge them without
  // projecting a potentially incorrect customer transaction status.
  const evidenceOnly = ["CONVERT", "CRYPTO_SEND", "CRYPTO_RECEIVE"].includes(prefix);
  const allowedStatuses = new Set([
    "created", "pending_approval", "process", "processing", "pending_liquidity",
    "pending", "complete", "failed", "pending_refund", "refund_processing",
    "refund_failed", "refunded", "cancelled", "canceled", "expired",
    // Direct-settlement Receive/Send transactions continue through a second
    // settlement lifecycle after the fiat leg. Yellow Card exposes these
    // statuses in actual v2 callbacks and its dashboard.
    "settlement_pending", "settlement_processing", "settlement_complete", "settlement_failed",
  ]);
  const providerTransactionId = String(payload.id ?? "").trim();
  if (!sequenceId || !apiKey || !event || (!direction && !evidenceOnly) ||
      !allowedStatuses.has(status) || !providerTransactionId ||
      (explicitStatus && explicitStatus !== eventStatus &&
        !(explicitStatus === "canceled" && eventStatus === "cancelled"))) {
    throw new Error("yellow_card_webhook_invalid_contract");
  }
  const rawExecutedAt = payload.executedAt;
  const numericExecutedAt = typeof rawExecutedAt === "number" || /^\d+$/.test(String(rawExecutedAt ?? "").trim())
    ? Number(rawExecutedAt)
    : null;
  const executedAtMs = numericExecutedAt !== null
    ? (numericExecutedAt < 10_000_000_000 ? numericExecutedAt * 1_000 : numericExecutedAt)
    : Date.parse(String(rawExecutedAt ?? "").trim());
  // Reject arbitrary numbers: accepted timestamps must resolve to a plausible
  // UTC instant and are canonicalized before database ordering/fingerprinting.
  if (!Number.isFinite(executedAtMs) || executedAtMs < Date.UTC(2000, 0, 1) || executedAtMs > Date.UTC(2100, 0, 1)) {
    throw new Error("yellow_card_webhook_invalid_executed_at");
  }
  const executedAt = new Date(executedAtMs).toISOString();
  return {
    event,
    sequenceId,
    apiKey,
    status: status === "canceled" ? "cancelled" : status,
    direction,
    projectTransaction: Boolean(direction),
    executedAt,
    executedAtMs,
    providerTransactionId,
    errorCode: String(payload.errorCode ?? "").trim() || null,
  };
}

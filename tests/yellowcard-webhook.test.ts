import {
  normalizeYellowCardWebhook,
  parseYellowCardWebhook,
  verifyYellowCardWebhookSignature,
} from "../supabase/functions/_shared/providers/yellowcard-webhook.ts";

function base64(bytes: ArrayBuffer) {
  let binary = "";
  for (const value of new Uint8Array(bytes)) binary += String.fromCharCode(value);
  return btoa(binary);
}

async function sign(raw: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return base64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
}

Deno.test("Yellow Card webhook verifies the exact raw body", async () => {
  const secret = "sandbox-secret";
  const raw = JSON.stringify({
    id: "provider-1", sequenceId: "sequence-1", status: "complete",
    apiKey: "api-key", event: "RECEIVE.COMPLETE", executedAt: "2026-08-19T12:00:00.000Z",
  });
  const signature = await sign(raw, secret);
  if (!await verifyYellowCardWebhookSignature(raw, signature, secret)) throw new Error("valid signature rejected");
  if (await verifyYellowCardWebhookSignature(`${raw} `, signature, secret)) throw new Error("modified body accepted");
});

Deno.test("Yellow Card webhook supports v2 and legacy transaction events", () => {
  for (const [event, direction] of [["RECEIVE.COMPLETE", "receive"], ["COLLECTION.FAILED", "receive"], ["SEND.PENDING", "payout"], ["PAYMENT.COMPLETE", "payout"]]) {
    const normalized = normalizeYellowCardWebhook({
      id: "provider-1", sequenceId: "sequence-1", apiKey: "api-key", event,
      executedAt: "2026-08-19T12:00:00.000Z",
    });
    if (normalized.direction !== direction) throw new Error(`wrong direction for ${event}`);
  }
});

Deno.test("Yellow Card webhook accepts Unix-millisecond execution timestamps", () => {
  const event = normalizeYellowCardWebhook({
    id: "provider-id",
    sequenceId: "sequence-id",
    status: "process",
    apiKey: "api-key",
    event: "RECEIVE.PROCESS",
    executedAt: 1787179009172,
  });
  if (event.executedAt !== "2026-08-19T22:36:49.172Z") {
    throw new Error(`timestamp was not canonicalized: ${event.executedAt}`);
  }
});

Deno.test("Yellow Card webhook projects direct-settlement terminal status", () => {
  const event = normalizeYellowCardWebhook({
    id: "provider-id",
    sequenceId: "sequence-id",
    status: "settlement_complete",
    apiKey: "api-key",
    event: "RECEIVE.SETTLEMENT_COMPLETE",
    executedAt: 1787179025084,
  });
  if (event.direction !== "receive" || !event.projectTransaction || event.status !== "settlement_complete") {
    throw new Error(`direct settlement event was not projectable: ${JSON.stringify(event)}`);
  }
});

Deno.test("Yellow Card webhook rejects implausible numeric timestamps", () => {
  let rejected = false;
  try {
    normalizeYellowCardWebhook({
      id: "provider-id", sequenceId: "sequence-id", status: "process",
      apiKey: "api-key", event: "RECEIVE.PROCESS", executedAt: 123,
    });
  } catch (error) {
    rejected = String(error).includes("invalid_executed_at");
  }
  if (!rejected) throw new Error("implausible timestamp was accepted");
});

Deno.test("Yellow Card webhook records current v2 settlement events without transaction projection", () => {
  for (const event of ["CONVERT.COMPLETE", "CRYPTO_SEND.COMPLETE", "CRYPTO_RECEIVE.COMPLETE"]) {
    const normalized = normalizeYellowCardWebhook({
      id: "provider-1", sequenceId: "sequence-1", status: "complete",
      apiKey: "api-key", event, executedAt: "2026-08-19T12:00:00.000Z",
    });
    if (normalized.direction !== null || normalized.projectTransaction) {
      throw new Error(`settlement event was incorrectly projected: ${event}`);
    }
  }
});

Deno.test("Yellow Card webhook rejects inconsistent status and missing provider id", () => {
  for (const payload of [
    { id: "provider-1", sequenceId: "sequence-1", apiKey: "api-key", event: "RECEIVE.COMPLETE", status: "failed", executedAt: "2026-08-19T12:00:00.000Z" },
    { sequenceId: "sequence-1", apiKey: "api-key", event: "SEND.COMPLETE", status: "complete", executedAt: "2026-08-19T12:00:00.000Z" },
  ]) {
    let rejected = false;
    try { normalizeYellowCardWebhook(payload); } catch { rejected = true; }
    if (!rejected) throw new Error("inconsistent webhook accepted");
  }
});

Deno.test("Yellow Card webhook rejects unknown and malformed events", () => {
  for (const payload of [
    { sequenceId: "sequence-1", apiKey: "api-key", event: "UNKNOWN.COMPLETE", executedAt: "2026-08-19T12:00:00.000Z" },
    { sequenceId: "sequence-1", apiKey: "api-key", event: "RECEIVE.UNKNOWN", executedAt: "2026-08-19T12:00:00.000Z" },
  ]) {
    let rejected = false;
    try { normalizeYellowCardWebhook(payload); } catch { rejected = true; }
    if (!rejected) throw new Error("invalid webhook accepted");
  }
  let invalidJson = false;
  try { parseYellowCardWebhook("not-json"); } catch { invalidJson = true; }
  if (!invalidJson) throw new Error("invalid JSON accepted");
});

import http from "node:http";
import { Storage } from "@google-cloud/storage";
import {
  createSignedReceipt,
  privateKeyFromBase64,
  requireLockedRetention,
  validateEnvelope,
  verifyAuthorization,
} from "./audit-contract.mjs";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const config = {
  bucketName: required("AUDIT_BUCKET"),
  bearerToken: required("AUDIT_SINK_TOKEN"),
  hmacSecret: required("AUDIT_HMAC_SECRET"),
  keyId: required("AUDIT_KEY_ID"),
  privateKey: privateKeyFromBase64(required("AUDIT_ED25519_PRIVATE_KEY_BASE64")),
  minimumDays: Number(process.env.AUDIT_MIN_RETENTION_DAYS || "30"),
};
if (!Number.isInteger(config.minimumDays) || config.minimumDays < 30) {
  throw new Error("AUDIT_MIN_RETENTION_DAYS must be an integer of at least 30");
}

const storage = new Storage();
const bucket = storage.bucket(config.bucketName);

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) throw new Error("audit request exceeds 1 MiB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function loadReceipt(eventId) {
  const receiptFile = bucket.file(`receipts/${eventId}.json`);
  const [exists] = await receiptFile.exists();
  if (!exists) return null;
  const [content] = await receiptFile.download();
  return JSON.parse(content.toString("utf8"));
}

async function handleDelivery(request, response) {
  const rawBody = await readBody(request);
  verifyAuthorization(request.headers, rawBody, config);
  const envelope = JSON.parse(rawBody.toString("utf8"));
  const event = validateEnvelope(envelope, request.headers["x-borderpay-audit-event"] || "");
  const [bucketMetadata] = await bucket.getMetadata();
  const retentionSeconds = requireLockedRetention(bucketMetadata, config.minimumDays);
  const eventName = `events/${String(event.sequence_no).padStart(20, "0")}-${event.event_id}.json`;
  const eventFile = bucket.file(eventName);

  try {
    await eventFile.save(rawBody, {
      resumable: false,
      contentType: "application/json",
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { metadata: { event_id: event.event_id, event_hash: event.event_hash } },
    });
  } catch (error) {
    if (Number(error?.code) !== 412) throw error;
    const [existing] = await eventFile.download();
    if (!existing.equals(rawBody)) throw new Error("immutable event identity collision");
  }

  const existingReceipt = await loadReceipt(event.event_id);
  if (existingReceipt) return send(response, 200, existingReceipt);

  const [eventMetadata] = await eventFile.getMetadata();
  const storedAt = new Date(eventMetadata.timeCreated).toISOString();
  const retentionUntil = eventMetadata.retentionExpirationTime
    ? new Date(eventMetadata.retentionExpirationTime).toISOString()
    : new Date(new Date(storedAt).getTime() + retentionSeconds * 1000).toISOString();
  const receipt = createSignedReceipt({
    event,
    bucketName: config.bucketName,
    keyId: config.keyId,
    storedAt,
    retentionUntil,
    privateKey: config.privateKey,
  });
  await bucket.file(`receipts/${event.event_id}.json`).save(JSON.stringify(receipt), {
    resumable: false,
    contentType: "application/json",
    preconditionOpts: { ifGenerationMatch: 0 },
  });
  return send(response, 201, receipt);
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") {
      const [metadata] = await bucket.getMetadata();
      requireLockedRetention(metadata, config.minimumDays);
      return send(response, 200, { status: "ready", key_id: config.keyId });
    }
    if (request.method !== "POST" || request.url !== "/v1/events") {
      return send(response, 404, { error: "not_found" });
    }
    return await handleDelivery(request, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "audit sink failure";
    const status = message.includes("unauthorized") ? 401 : 503;
    return send(response, status, { error: "audit_sink_rejected", detail: message });
  }
});

server.listen(Number(process.env.PORT || "8080"));

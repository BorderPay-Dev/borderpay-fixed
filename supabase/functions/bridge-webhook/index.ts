// bridge-webhook — receives signed Bridge webhooks.
//
// Signature verification follows the official Bridge spec:
//   header  : X-Webhook-Signature  -> "t=<timestamp_ms>,v0=<base64_sig>"
//   payload : `${timestamp}.${rawBody}`           (literal dot, raw bytes;
//             timestamp is the ORIGINAL header string, not a reparsed Number)
//   algo    : RSASSA-PKCS1-v1_5; Bridge signs over the SHA-256 *digest* of the
//             payload (their Node sample hashes signedPayload to a digest, then
//             createVerify('RSA-SHA256').update(digest)). WebCrypto's verify
//             hashes its input once under SHA-256, so we pass the digest bytes
//             (not the raw payload string) to reproduce that double hash.
//   key     : per-endpoint PEM public key (BRIDGE_WEBHOOK_PUBLIC_KEY env)
//   replay  : reject events older than 10 minutes
//
// Pipeline:
//   1. Read raw body BEFORE any JSON parse (signature is over the bytes).
//   2. Parse + verify signature; reject 400 on replay, 401 on invalid sig.
//   3. Single atomic call to public.ingest_bridge_event() RPC, which inserts
//      into bridge_webhook_events AND pending_events in one transaction.
//      If the pending_events insert fails the bridge_webhook_events row
//      rolls back too, so a Bridge retry sees no duplicate and re-runs.
//   4. Return 200 OK so Bridge stops retrying.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { assertBridgeIngressDecision, evaluateBridgeIngressEvent } from "../_shared/bridge-ingress-evaluator.ts";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PUBLIC_KEY_PEM        = Deno.env.get("BRIDGE_WEBHOOK_PUBLIC_KEY") ?? "";
const REPLAY_WINDOW_MS      = 10 * 60 * 1000;
const FUTURE_SKEW_MS        = 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "x-webhook-signature, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function webhookLog(stage: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    service: "bridge-webhook",
    stage,
    at: new Date().toISOString(),
    ...detail,
  }));
}

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function b64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const padded  = cleaned + "=".repeat((4 - cleaned.length % 4) % 4);
  const bin     = atob(padded);
  const out     = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function pemToDer(pem: string): Uint8Array {
  const inner = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g,   "")
    .replace(/\s+/g, "");
  return b64ToBytes(inner);
}

function parseSigHeader(h: string): { ts: number; tsRaw: string; sig: Uint8Array } | null {
  const parts = h.split(",").map(s => s.trim());
  let ts: number | null = null;
  let tsRaw: string | null = null;
  let sigB64: string | null = null;
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const k = p.slice(0, eq);
    const v = p.slice(eq + 1);
    if (k === "t")  { tsRaw = v; ts = Number(v); }
    if (k === "v0") sigB64 = v;
  }
  if (!ts || !Number.isFinite(ts) || tsRaw === null || !sigB64) return null;
  // tsRaw is the verbatim header timestamp used to build the signed payload;
  // ts (Number) is used only for the replay-window comparison.
  try { return { ts, tsRaw, sig: b64ToBytes(sigB64) }; } catch { return null; }
}

let cachedKey: CryptoKey | null = null;
async function loadPublicKey(): Promise<CryptoKey | null> {
  if (cachedKey) return cachedKey;
  if (!PUBLIC_KEY_PEM) return null;
  try {
    const der = pemToDer(PUBLIC_KEY_PEM);
    cachedKey = await crypto.subtle.importKey(
      "spki", der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false, ["verify"],
    );
    return cachedKey;
  } catch (_) { return null; }
}

async function verifySignature(rawBody: string, tsRaw: string, sig: Uint8Array): Promise<boolean> {
  const key = await loadPublicKey();
  if (!key) return false;
  // Bridge's signer hashes the payload to a SHA-256 digest, then RSA-SHA256
  // verifies over that digest (Node createVerify('RSA-SHA256').update(digest)).
  // WebCrypto verify() hashes its input once under SHA-256, so we must pass the
  // digest BYTES — passing the raw payload string would only single-hash and
  // never match. tsRaw is the verbatim header timestamp.
  const signedPayload = new TextEncoder().encode(`${tsRaw}.${rawBody}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", signedPayload));
  try { return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, digest); }
  catch (_) { return false; }
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({
      success: false,
      error: "Invalid request method",
      code: "method_not_allowed",
      expected_method: "POST",
    }, 405);
  }

  const rawBody = await req.text();
  const sigHdr  = req.headers.get("x-webhook-signature") || req.headers.get("X-Webhook-Signature") || "";
  webhookLog("request_received", {
    content_length: rawBody.length,
    has_signature_header: Boolean(sigHdr),
  });

  const parsed = sigHdr ? parseSigHeader(sigHdr) : null;
  if (!parsed) {
    const evalRes = evaluateBridgeIngressEvent({
      source: "bridge",
      eventIdRaw: null,
      eventTypeRaw: null,
      payload: {},
      signatureOk: false,
      replayWindowOk: true,
      parseOk: false,
    });
    return json({
      success: false,
      error: "Missing or malformed webhook signature",
      code: "invalid_signature_header",
      reason_code: evalRes.reason_code,
    }, 401);
  }

  const nowMs = Date.now();
  const ageMs = nowMs - parsed.ts;
  // Reject old events beyond replay window and timestamps too far in the future.
  // Using absolute age can accidentally accept future-dated timestamps.
  if (ageMs > REPLAY_WINDOW_MS || parsed.ts - nowMs > FUTURE_SKEW_MS) {
    const evalRes = evaluateBridgeIngressEvent({
      source: "bridge",
      eventIdRaw: null,
      eventTypeRaw: null,
      payload: {},
      signatureOk: true,
      replayWindowOk: false,
      parseOk: false,
    });
    return json({
      success: false,
      error: "Webhook timestamp outside replay window",
      code: "replay_window_violation",
      age_ms: ageMs,
      reason_code: evalRes.reason_code,
    }, 400);
  }

  const sigOk = await verifySignature(rawBody, parsed.tsRaw, parsed.sig);

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch {
    const evalRes = evaluateBridgeIngressEvent({
      source: "bridge",
      eventIdRaw: null,
      eventTypeRaw: null,
      payload: {},
      signatureOk: sigOk,
      replayWindowOk: true,
      parseOk: false,
    });
    return json({
      success: false,
      error: "Invalid JSON payload",
      code: "invalid_json_payload",
      reason_code: evalRes.reason_code,
    }, 400);
  }

  const eventId   = payload?.id || payload?.event_id || payload?.data?.id || `unsigned_${await sha256Hex(rawBody)}`;
  const eventType = payload?.type || payload?.event_type || "unknown";
  const hash      = await sha256Hex(rawBody);
  const ingress = evaluateBridgeIngressEvent({
    source: "bridge",
    eventIdRaw: String(eventId),
    eventTypeRaw: String(eventType),
    payload,
    signatureOk: sigOk,
    replayWindowOk: true,
    parseOk: true,
  });
  assertBridgeIngressDecision(ingress);
  if (ingress.decision === "reject") {
    webhookLog("signature_rejected", { event_type: ingress.derived_event_type, reason_code: ingress.reason_code });
    return json({
      success: false,
      error: "Invalid signature",
      code: "invalid_signature",
      reason_code: ingress.reason_code,
    }, 401);
  }
  if (ingress.routing_target !== "queue") {
    webhookLog("event_ignored", {
      event_id: eventId,
      event_type: ingress.derived_event_type,
      reason_code: ingress.reason_code,
      routing_target: ingress.routing_target,
    });
    return json({
      success: true,
      code: "webhook_ignored",
      summary: {
        routing_target: ingress.routing_target,
        reason_code: ingress.reason_code,
      },
      status: "ignored",
      event_id: eventId,
      reason_code: ingress.reason_code,
      routing_target: ingress.routing_target,
    }, 200);
  }

  // Single atomic RPC: inserts bridge_webhook_events + pending_events in one
  // transaction. Rejected events are logged but not enqueued.
  const { data: ingest, error: rpcErr } = await supa.rpc("ingest_bridge_event", {
    p_event_id:     String(eventId),
    p_event_type:   ingress.derived_event_type,
    p_signature_ok: sigOk,
    p_payload:      ingress.normalized_payload,
    p_payload_hash: hash,
  });
  if (rpcErr) {
    webhookLog("ingest_failed", { event_id: eventId, event_type: ingress.derived_event_type, error: rpcErr.message });
    return json({
      success: false,
      error: "Ingest failed",
      code: "ingest_failed",
      reason_code: "ingest_error",
      event_id: eventId,
    }, 500);
  }
  // RPC returns one row with shape { was_duplicate, was_rejected, queued, pending_id }
  const row = Array.isArray(ingest) ? ingest[0] : ingest;
  if (row?.was_rejected) {
    webhookLog("ingest_rejected", { event_id: eventId, event_type: ingress.derived_event_type });
    return json({
      success: false,
      error: "Invalid signature",
      code: "invalid_signature",
    }, 401);
  }
  if (row?.was_duplicate) {
    const duplicate = evaluateBridgeIngressEvent({
      source: "bridge",
      eventIdRaw: String(eventId),
      eventTypeRaw: ingress.derived_event_type,
      payload: ingress.normalized_payload,
      signatureOk: true,
      replayWindowOk: true,
      parseOk: true,
      knownDuplicate: true,
    });
    assertBridgeIngressDecision(duplicate);
    webhookLog("duplicate_received", {
      event_id: eventId,
      event_type: ingress.derived_event_type,
      reason_code: duplicate.reason_code,
    });
    return json({
      success: true,
      code: "webhook_duplicate",
      summary: {
        idempotency_key: duplicate.idempotency_key,
        reason_code: duplicate.reason_code,
      },
      status: "duplicate",
      event_id: eventId,
      reason_code: duplicate.reason_code,
      idempotency_key: duplicate.idempotency_key,
    }, 200);
  }
  if (!row?.queued) {
    webhookLog("queue_missing", { event_id: eventId, event_type: ingress.derived_event_type });
    return json({
      success: false,
      error: "Ingest returned no queue confirmation",
      code: "queue_confirmation_missing",
    }, 500);
  }

  webhookLog("webhook_received", {
    event_id: eventId,
    event_type: ingress.derived_event_type,
    pending_id: row.pending_id,
  });

  return json({
    success: true,
    code: "webhook_queued",
    summary: { pending_id: row.pending_id ?? null },
    status: "queued",
    event_id: eventId,
    pending_id: row.pending_id,
  }, 200);
});

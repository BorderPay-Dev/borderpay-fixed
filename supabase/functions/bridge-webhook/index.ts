// bridge-webhook — receives signed Bridge webhooks.
//
// Signature verification follows the official Bridge spec:
//   header  : X-Webhook-Signature  -> "t=<timestamp_ms>,v0=<base64_sig>"
//   payload : `${timestamp}.${rawBody}`           (literal dot, raw bytes)
//   algo    : RSASSA-PKCS1-v1_5 with SHA-256
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

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PUBLIC_KEY_PEM        = Deno.env.get("BRIDGE_WEBHOOK_PUBLIC_KEY") ?? "";
const REPLAY_WINDOW_MS      = 10 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "x-webhook-signature, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

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

function parseSigHeader(h: string): { ts: number; sig: Uint8Array } | null {
  const parts = h.split(",").map(s => s.trim());
  let ts: number | null = null;
  let sigB64: string | null = null;
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const k = p.slice(0, eq);
    const v = p.slice(eq + 1);
    if (k === "t")  ts = Number(v);
    if (k === "v0") sigB64 = v;
  }
  if (!ts || !Number.isFinite(ts) || !sigB64) return null;
  try { return { ts, sig: b64ToBytes(sigB64) }; } catch { return null; }
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

async function verifySignature(rawBody: string, ts: number, sig: Uint8Array): Promise<boolean> {
  const key = await loadPublicKey();
  if (!key) return false;
  const signed = new TextEncoder().encode(`${ts}.${rawBody}`);
  try { return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, signed); }
  catch (_) { return false; }
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  const rawBody = await req.text();
  const sigHdr  = req.headers.get("x-webhook-signature") || req.headers.get("X-Webhook-Signature") || "";

  const parsed = sigHdr ? parseSigHeader(sigHdr) : null;
  if (!parsed) {
    return json({ error: "missing or malformed X-Webhook-Signature" }, 401);
  }

  const ageMs = Math.abs(Date.now() - parsed.ts);
  if (ageMs > REPLAY_WINDOW_MS) {
    return json({ error: "timestamp outside replay window", age_ms: ageMs }, 400);
  }

  const sigOk = await verifySignature(rawBody, parsed.ts, parsed.sig);

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: "invalid JSON" }, 400); }

  const eventId   = payload?.id || payload?.event_id || payload?.data?.id || `unsigned_${await sha256Hex(rawBody)}`;
  const eventType = payload?.type || payload?.event_type || "unknown";
  const hash      = await sha256Hex(rawBody);

  // Single atomic RPC: inserts bridge_webhook_events + pending_events in one
  // transaction. Rejected events are logged but not enqueued.
  const { data: ingest, error: rpcErr } = await supa.rpc("ingest_bridge_event", {
    p_event_id:     String(eventId),
    p_event_type:   String(eventType),
    p_signature_ok: sigOk,
    p_payload:      payload,
    p_payload_hash: hash,
  });
  if (rpcErr) {
    return json({ error: "ingest failed", detail: rpcErr.message }, 500);
  }
  // RPC returns one row with shape { was_duplicate, was_rejected, queued, pending_id }
  const row = Array.isArray(ingest) ? ingest[0] : ingest;
  if (row?.was_rejected) {
    return json({ error: "invalid signature" }, 401);
  }
  if (row?.was_duplicate) {
    return json({ status: "duplicate", event_id: eventId }, 200);
  }
  if (!row?.queued) {
    return json({ error: "ingest returned no queue confirmation" }, 500);
  }

  return json({ status: "queued", event_id: eventId, pending_id: row.pending_id }, 200);
});

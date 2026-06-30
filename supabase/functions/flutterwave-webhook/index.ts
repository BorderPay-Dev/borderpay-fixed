import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { verifyFlutterwaveWebhookSignature } from "../_shared/providers/flutterwave.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, verif-hash, x-verif-hash, x-flutterwave-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const REPLAY_WINDOW_MINUTES = Number(Deno.env.get("FLW_WEBHOOK_REPLAY_WINDOW_MINUTES") || "1440");

function extractEventTimestampMs(payload: Record<string, unknown>): number | null {
  const data = (payload.data && typeof payload.data === "object")
    ? (payload.data as Record<string, unknown>)
    : null;

  const candidates = [
    payload.timestamp,
    payload.created_at,
    payload.event_created_at,
    data?.created_at,
    data?.timestamp,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate > 1e12 ? candidate : candidate * 1000;
    }
    const parsed = Date.parse(String(candidate));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function extractEventId(payload: Record<string, unknown>): string {
  const data = (payload.data && typeof payload.data === "object")
    ? (payload.data as Record<string, unknown>)
    : null;
  return String(
    payload.id
    || payload.event_id
    || data?.id
    || payload.tx_ref
    || payload.reference
    || "unknown",
  ).trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const rawBody = await req.text();
  const verified = await verifyFlutterwaveWebhookSignature(req.headers);
  if (!verified) {
    return json({ success: false, code: "invalid_signature", error: "Webhook signature verification failed." }, 401);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return json({ success: false, code: "invalid_json", error: "Webhook payload must be valid JSON." }, 400);
  }

  const eventTimestampMs = extractEventTimestampMs(payload);
  if (eventTimestampMs && Number.isFinite(eventTimestampMs)) {
    const ageMs = Math.abs(Date.now() - eventTimestampMs);
    const replayWindowMs = Math.max(1, REPLAY_WINDOW_MINUTES) * 60 * 1000;
    if (ageMs > replayWindowMs) {
      return json({
        success: false,
        code: "outside_replay_window",
        error: "Webhook event timestamp is outside replay window.",
        data: { age_ms: ageMs, replay_window_ms: replayWindowMs },
      }, 400);
    }
  }

  const eventId = extractEventId(payload);
  const eventType = String(payload.event || payload.event_type || "unknown");

  // Stage scaffold: acknowledge only.
  // Bridge remains the active money-movement source until FLW execution cutover.
  return json({
    success: true,
    code: "flutterwave_webhook_accepted",
    data: {
      event_id: eventId,
      event_type: eventType,
      replay_window_minutes: REPLAY_WINDOW_MINUTES,
      received_at: new Date().toISOString(),
      processing_mode: "scaffold_ack_only",
    },
  }, 202);
});


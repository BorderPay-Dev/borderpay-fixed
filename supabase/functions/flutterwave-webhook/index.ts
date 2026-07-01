import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { mapFlutterwaveProviderStatus, verifyFlutterwaveWebhookSignature } from "../_shared/providers/flutterwave.ts";

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
const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

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

function extractTransferEnvelope(payload: Record<string, unknown>): {
  reference: string | null;
  providerTransferId: string | null;
  providerStatus: string | null;
  userIdFromMeta: string | null;
} {
  const data = (payload.data && typeof payload.data === "object")
    ? (payload.data as Record<string, unknown>)
    : null;
  const meta = (data?.meta && typeof data.meta === "object")
    ? (data.meta as Record<string, unknown>)
    : null;
  const reference = String(
    data?.reference
    || data?.tx_ref
    || payload.reference
    || payload.tx_ref
    || "",
  ).trim() || null;
  const providerTransferId = String(
    data?.id
    || payload.id
    || payload.event_id
    || "",
  ).trim() || null;
  const providerStatus = String(
    data?.status
    || payload.status
    || "",
  ).trim() || null;
  const userIdFromMeta = String(
    meta?.borderpay_user_id
    || data?.user_id
    || "",
  ).trim() || null;
  return { reference, providerTransferId, providerStatus, userIdFromMeta };
}

function shouldReconcileMoneyMovementEvent(eventType: string, transfer: {
  reference: string | null;
  providerTransferId: string | null;
  providerStatus: string | null;
}): boolean {
  const t = String(eventType || "").trim().toLowerCase();
  const movementType = t.includes("transfer") || t.includes("payout") || t.includes("charge") || t.includes("collection");
  if (!movementType) return false;
  return Boolean(transfer.reference || transfer.providerTransferId || transfer.providerStatus);
}

function inferMovementDirection(eventType: string): "payout" | "receive" {
  const t = String(eventType || "").trim().toLowerCase();
  if (t.includes("charge") || t.includes("collection")) return "receive";
  return "payout";
}

function isUuid(value: string | null | undefined): boolean {
  const v = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const rawBody = await req.text();
  const payloadHashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody || ""));
  const payloadHash = Array.from(new Uint8Array(payloadHashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");

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

  const eventIdRaw = extractEventId(payload);
  const eventId = eventIdRaw && eventIdRaw !== "unknown"
    ? eventIdRaw
    : `hash:${payloadHash.slice(0, 32)}`;
  const eventType = String(payload.event || payload.event_type || "unknown");
  const transfer = extractTransferEnvelope(payload);
  const transferEventEligible = shouldReconcileMoneyMovementEvent(eventType, transfer);
  const movementDirection = inferMovementDirection(eventType);
  const mappedStatus = mapFlutterwaveProviderStatus(transfer.providerStatus);

  let reconciled = false;
  let processingError: string | null = null;
  try {
    // Idempotent event sink.
    const { data: existingEvent } = await supa
      .from("flutterwave_webhook_events")
      .select("id, event_id, processing_status")
      .eq("event_id", eventId)
      .maybeSingle();
    if (!existingEvent) {
      await supa.from("flutterwave_webhook_events").insert({
        event_id: eventId,
        event_type: eventType,
        signature_ok: true,
        payload,
        payload_hash: payloadHash,
        headers: {
          "verif-hash": req.headers.get("verif-hash") || req.headers.get("Verif-Hash") || null,
          "x-verif-hash": req.headers.get("x-verif-hash") || null,
          "x-flutterwave-signature": req.headers.get("x-flutterwave-signature") || req.headers.get("X-Flutterwave-Signature") || null,
        },
        transfer_reference: transfer.reference,
        provider_transfer_id: transfer.providerTransferId,
        processing_status: "received",
      });
    } else {
      await supa.from("flutterwave_webhook_events")
        .update({
          payload,
          payload_hash: payloadHash,
          transfer_reference: transfer.reference,
          provider_transfer_id: transfer.providerTransferId,
          processing_status: "duplicate",
        })
        .eq("event_id", eventId);
    }

    if (transferEventEligible) {
      // Reconciliation path:
      // 1) provider_transfer_id (globally unique)
      // 2) reference + user_id (only when user id is present and valid)
      if (transfer.providerTransferId) {
        const update = await supa.from("flutterwave_transfers")
          .update({
            status: mappedStatus,
            provider_status: transfer.providerStatus,
            provider_response: payload,
            provider_http_status: 202,
            webhook_last_event_id: eventId,
            last_error: null,
            last_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("provider_transfer_id", transfer.providerTransferId)
          .eq("source", "flutterwave")
          .select("id")
          .limit(1);
        reconciled = !update.error && Array.isArray(update.data) && update.data.length > 0;
      }

      if (!reconciled && transfer.reference && isUuid(transfer.userIdFromMeta)) {
        const update = await supa.from("flutterwave_transfers")
          .update({
            provider_transfer_id: transfer.providerTransferId,
            status: mappedStatus,
            provider_status: transfer.providerStatus,
            provider_response: payload,
            provider_http_status: 202,
            webhook_last_event_id: eventId,
            last_error: null,
            last_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", transfer.userIdFromMeta)
          .eq("direction", movementDirection)
          .eq("reference", transfer.reference)
          .eq("source", "flutterwave")
          .select("id")
          .limit(1);
        reconciled = !update.error && Array.isArray(update.data) && update.data.length > 0;
      }

      // If no record exists yet but webhook includes both user + reference, seed one.
      if (!reconciled && transfer.reference && isUuid(transfer.userIdFromMeta)) {
        await supa.from("flutterwave_transfers").upsert({
          user_id: transfer.userIdFromMeta,
          direction: movementDirection,
          reference: transfer.reference,
          provider_transfer_id: transfer.providerTransferId,
          source: "flutterwave",
          status: mappedStatus,
          provider_status: transfer.providerStatus,
          request_payload: {},
          provider_response: payload,
          metadata: { seeded_from_webhook: true },
          provider_http_status: 202,
          webhook_last_event_id: eventId,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,reference" });
        reconciled = true;
      }

      if (!reconciled && transfer.reference && transfer.userIdFromMeta && !isUuid(transfer.userIdFromMeta)) {
        processingError = "invalid_user_id_in_meta";
      }
      if (!reconciled && transfer.reference && !transfer.providerTransferId && !transfer.userIdFromMeta) {
        processingError = "insufficient_identity_for_reference_reconcile";
      }
    }
  } catch (err: any) {
    processingError = String(err?.message || "webhook_processing_failed");
  }

  await supa.from("flutterwave_webhook_events")
    .update({
      processing_status: reconciled ? "processed" : (processingError ? "failed" : "ignored"),
      processed_at: new Date().toISOString(),
      processing_error: reconciled ? null : (processingError || "no_matching_transfer_record"),
    })
    .eq("event_id", eventId);

  return json({
    success: true,
    code: "flutterwave_webhook_accepted",
    data: {
      event_id: eventId,
      event_type: eventType,
      replay_window_minutes: REPLAY_WINDOW_MINUTES,
      transfer_reference: transfer.reference,
      provider_transfer_id: transfer.providerTransferId,
      mapped_status: mappedStatus,
      transfer_event_eligible: transferEventEligible,
      movement_direction: movementDirection,
      reconciled,
      processing_error: processingError,
      received_at: new Date().toISOString(),
      processing_mode: "persist_and_reconcile",
    },
  }, 202);
});

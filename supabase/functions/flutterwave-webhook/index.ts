import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
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

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function normStatus(input: unknown): "pending" | "completed" | "failed" {
  const s = String(input || "").trim().toLowerCase();
  if (["successful", "success", "completed", "paid", "succeeded"].includes(s)) return "completed";
  if (["failed", "cancelled", "canceled", "reversed", "declined", "error"].includes(s)) return "failed";
  return "pending";
}

function toMinorUnits(amount: unknown, currency: string): string | null {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const noDecimal = ["JPY", "UGX", "RWF", "XOF", "XAF", "BIF", "GNF"];
  const factor = noDecimal.includes(currency.toUpperCase()) ? 1 : 100;
  return String(Math.round(n * factor));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const rawBody = await req.text();
  let payload: any = {};
  try { payload = rawBody ? JSON.parse(rawBody) : {}; } catch { payload = {}; }

  const verified = await verifyFlutterwaveWebhookSignature(req.headers);
  if (!verified) {
    return json({ success: false, code: "invalid_signature", error: "Webhook signature verification failed." }, 401);
  }

  const eventType = String(payload?.event || payload?.event_type || "unknown");
  const data = (payload?.data && typeof payload.data === "object") ? payload.data : payload;
  const txRef = String(
    data?.tx_ref
    || data?.reference
    || data?.txRef
    || data?.meta?.borderpay_tx_ref
    || "",
  ).trim();
  const collectionId = String(data?.id || data?.flw_ref || txRef || "").trim();
  const status = normStatus(data?.status || data?.payment_status);
  const currency = String(data?.currency || "").trim().toUpperCase() || "USD";
  const amount = Number(data?.amount || data?.charged_amount || 0);
  const eventId = String(payload?.id || `${eventType}:${collectionId || txRef}:${Date.now()}`);
  const accountType = String(data?.meta?.borderpay_account_type || "").toLowerCase();

  const upsertPayload: Record<string, unknown> = {
    tx_ref: txRef || collectionId || eventId,
    flutterwave_collection_id: collectionId || null,
    flutterwave_event_id: eventId,
    amount: Number.isFinite(amount) ? amount : null,
    currency,
    status,
    metadata: {
      event_type: eventType,
      account_type: accountType || null,
      source: "flutterwave",
    },
    raw_payload: payload,
  };

  const userIdFromMeta = String(data?.meta?.borderpay_user_id || "").trim();
  if (userIdFromMeta) {
    if (accountType === "business") {
      upsertPayload.business_user_id = userIdFromMeta;
      upsertPayload.user_id = null;
    } else {
      upsertPayload.user_id = userIdFromMeta;
      upsertPayload.business_user_id = null;
    }
  }

  const { error: colErr } = await supa
    .from("flutterwave_collections")
    .upsert(upsertPayload, { onConflict: "tx_ref" });
  if (colErr) {
    return json({
      success: false,
      code: "collection_projection_failed",
      error: "Failed to project collection webhook.",
      data: { event_type: eventType, tx_ref: txRef || null },
    }, 500);
  }

  const { data: projectedCollection } = await supa
    .from("flutterwave_collections")
    .select("tx_ref,user_id,business_user_id")
    .eq("tx_ref", String(upsertPayload.tx_ref))
    .maybeSingle();

  const resolvedUserId = projectedCollection?.user_id || projectedCollection?.business_user_id || null;

  if (resolvedUserId) {
    const reference = `flutterwave:collection:${String(upsertPayload.tx_ref)}`;
    const txStatus = status === "completed" ? "completed" : status === "failed" ? "failed" : "pending";
    await supa.from("transactions").upsert({
      user_id: resolvedUserId,
      type: "deposit",
      amount: Number.isFinite(amount) ? amount : 0,
      currency,
      status: txStatus,
      reference,
      provider: "bridge",
      description: "Collection received",
      metadata: {
        source: "flutterwave",
        event_type: eventType,
        tx_ref: String(upsertPayload.tx_ref),
        flutterwave_collection_id: collectionId || null,
        flutterwave_event_id: eventId,
        raw: data,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "reference" });

    if (status === "completed") {
      const { data: existingNotification } = await supa
        .from("notifications")
        .select("id")
        .eq("user_id", resolvedUserId)
        .eq("type", "transaction")
        .contains("metadata", { tx_ref: String(upsertPayload.tx_ref), source: "flutterwave" })
        .maybeSingle();

      if (!existingNotification?.id) {
        await supa.from("notifications").insert({
          user_id: resolvedUserId,
          type: "transaction",
          title: "Deposit received",
          body: `Received ${Number.isFinite(amount) ? amount : 0} ${currency}.`,
          metadata: {
            source: "flutterwave",
            tx_ref: String(upsertPayload.tx_ref),
            flutterwave_collection_id: collectionId || null,
            flutterwave_event_id: eventId,
            amount: Number.isFinite(amount) ? amount : 0,
            currency,
          },
        });
      }

      const amountMinor = toMinorUnits(amount, currency);
      if (amountMinor) {
        await supa.from("bridge_balance_ledger").upsert({
          event_id: `flw:${eventId}`,
          provider: "flutterwave",
          entity_type: "transfer",
          entity_id: collectionId || String(upsertPayload.tx_ref),
          user_id: accountType === "business" ? null : resolvedUserId,
          business_user_id: accountType === "business" ? resolvedUserId : null,
          currency,
          amount_minor: amountMinor,
          direction: "credit",
          metadata: {
            source: "flutterwave",
            tx_ref: String(upsertPayload.tx_ref),
            flutterwave_collection_id: collectionId || null,
            flutterwave_event_id: eventId,
          },
        }, { onConflict: "event_id" });
      }
    }
  }

  return json({
    success: true,
    code: "flutterwave_webhook_accepted",
    data: {
      event_type: eventType,
      received_at: new Date().toISOString(),
      processing_mode: "projected",
      tx_ref: txRef || null,
      status,
    },
  }, 202);
});

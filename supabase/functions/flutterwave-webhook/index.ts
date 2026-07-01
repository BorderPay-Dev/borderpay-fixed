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

function isTransferEvent(eventType: string): boolean {
  const e = eventType.toLowerCase();
  return e.includes("transfer") || e.includes("payout");
}

async function claimWebhookEvent(eventId: string, eventType: string, flow: "collection" | "transfer" | "unknown", payload: unknown) {
  const { data, error } = await supa
    .from("flutterwave_webhook_events")
    .insert({
      event_id: eventId,
      event_type: eventType,
      flow,
      processing_status: "processing",
      payload: payload ?? {},
      metadata: { source: "flutterwave" },
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // Postgres 23505 unique_violation => duplicate event_id
    if ((error as any)?.code === "23505") return { claimed: false, duplicate: true as const };
    throw error;
  }

  return { claimed: Boolean(data?.id), duplicate: false as const };
}

async function markWebhookEventStatus(eventId: string, status: "completed" | "failed") {
  await supa
    .from("flutterwave_webhook_events")
    .update({ processing_status: status, processed_at: new Date().toISOString() })
    .eq("event_id", eventId);
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
  const transferEvent = isTransferEvent(eventType);

  const txRef = String(
    data?.tx_ref
    || data?.reference
    || data?.txRef
    || data?.meta?.borderpay_tx_ref
    || "",
  ).trim();

  const transferReference = String(
    data?.reference
    || data?.tx_ref
    || data?.meta?.borderpay_transfer_reference
    || "",
  ).trim();

  const collectionId = String(data?.id || data?.flw_ref || txRef || "").trim();
  const transferId = String(data?.id || data?.transfer_id || data?.flw_ref || "").trim();
  const status = normStatus(data?.status || data?.payment_status);
  const currency = String(data?.currency || "").trim().toUpperCase() || "USD";
  const amount = Number(data?.amount || data?.charged_amount || 0);
  const eventId = String(payload?.id || `${eventType}:${collectionId || transferReference || txRef}:${Date.now()}`);
  const accountType = String(data?.meta?.borderpay_account_type || "").toLowerCase();
  const userIdFromMeta = String(data?.meta?.borderpay_user_id || "").trim();
  const flow: "collection" | "transfer" | "unknown" = transferEvent ? "transfer" : "collection";

  const claim = await claimWebhookEvent(eventId, eventType, flow, payload);
  if (!claim.claimed) {
    return json({
      success: true,
      code: "flutterwave_webhook_duplicate_ignored",
      data: {
        event_type: eventType,
        event_id: eventId,
        flow,
        processing_mode: "duplicate_ignored",
      },
    }, 200);
  }

  if (transferEvent) {
    const transferPayload: Record<string, unknown> = {
      reference: transferReference || transferId || eventId,
      flutterwave_transfer_id: transferId || null,
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

    if (userIdFromMeta) {
      if (accountType === "business") {
        transferPayload.business_user_id = userIdFromMeta;
        transferPayload.user_id = null;
      } else {
        transferPayload.user_id = userIdFromMeta;
        transferPayload.business_user_id = null;
      }
    }

    const { error: transferErr } = await supa
      .from("flutterwave_transfers")
      .upsert(transferPayload, { onConflict: "reference" });

    if (transferErr) {
      await markWebhookEventStatus(eventId, "failed");
      return json({
        success: false,
        code: "transfer_projection_failed",
        error: "Failed to project transfer webhook.",
        data: { event_type: eventType, reference: transferReference || null },
      }, 500);
    }

    const { data: projectedTransfer } = await supa
      .from("flutterwave_transfers")
      .select("reference,user_id,business_user_id")
      .eq("reference", String(transferPayload.reference))
      .maybeSingle();

    const resolvedUserId = projectedTransfer?.user_id || projectedTransfer?.business_user_id || null;

    if (resolvedUserId) {
      const reference = `flutterwave:transfer:${String(transferPayload.reference)}`;
      const txStatus = status === "completed" ? "completed" : status === "failed" ? "failed" : "pending";

      await supa.from("transactions").upsert({
        user_id: resolvedUserId,
        type: "transfer",
        amount: Number.isFinite(amount) ? amount : 0,
        currency,
        status: txStatus,
        reference,
        provider: "bridge",
        description: "Transfer payout",
        metadata: {
          source: "flutterwave",
          event_type: eventType,
          reference: String(transferPayload.reference),
          flutterwave_transfer_id: transferId || null,
          flutterwave_event_id: eventId,
          raw: data,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: "reference" });

      if (status === "completed" || status === "failed") {
        const { data: existingNotification } = await supa
          .from("notifications")
          .select("id")
          .eq("user_id", resolvedUserId)
          .eq("type", "transaction")
          .contains("metadata", { reference: String(transferPayload.reference), source: "flutterwave" })
          .maybeSingle();

        if (!existingNotification?.id) {
          const title = status === "completed" ? "Transfer completed" : "Transfer failed";
          const body = status === "completed"
            ? `Sent ${Number.isFinite(amount) ? amount : 0} ${currency}.`
            : `Transfer of ${Number.isFinite(amount) ? amount : 0} ${currency} failed.`;
          await supa.from("notifications").insert({
            user_id: resolvedUserId,
            type: "transaction",
            title,
            body,
            metadata: {
              source: "flutterwave",
              reference: String(transferPayload.reference),
              flutterwave_transfer_id: transferId || null,
              flutterwave_event_id: eventId,
              amount: Number.isFinite(amount) ? amount : 0,
              currency,
              status,
            },
          });
        }
      }

      if (status === "completed") {
        const amountMinor = toMinorUnits(amount, currency);
        if (amountMinor) {
          await supa.from("bridge_balance_ledger").upsert({
            event_id: `flw:${eventId}`,
            provider: "flutterwave",
            entity_type: "transfer",
            entity_id: transferId || String(transferPayload.reference),
            user_id: accountType === "business" ? null : resolvedUserId,
            business_user_id: accountType === "business" ? resolvedUserId : null,
            currency,
            amount_minor: amountMinor,
            direction: "debit",
            metadata: {
              source: "flutterwave",
              reference: String(transferPayload.reference),
              flutterwave_transfer_id: transferId || null,
              flutterwave_event_id: eventId,
            },
          }, { onConflict: "event_id" });
        }
      }
    }

    await markWebhookEventStatus(eventId, "completed");
    return json({
      success: true,
      code: "flutterwave_webhook_accepted",
      data: {
        event_type: eventType,
        received_at: new Date().toISOString(),
        processing_mode: "projected",
        flow: "transfer",
        reference: transferReference || null,
        tx_ref: null,
        status,
      },
    }, 202);
  }

  const collectionPayload: Record<string, unknown> = {
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

  if (userIdFromMeta) {
    if (accountType === "business") {
      collectionPayload.business_user_id = userIdFromMeta;
      collectionPayload.user_id = null;
    } else {
      collectionPayload.user_id = userIdFromMeta;
      collectionPayload.business_user_id = null;
    }
  }

  const { error: colErr } = await supa
    .from("flutterwave_collections")
    .upsert(collectionPayload, { onConflict: "tx_ref" });

  if (colErr) {
    await markWebhookEventStatus(eventId, "failed");
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
    .eq("tx_ref", String(collectionPayload.tx_ref))
    .maybeSingle();

  const resolvedUserId = projectedCollection?.user_id || projectedCollection?.business_user_id || null;

  if (resolvedUserId) {
    const reference = `flutterwave:collection:${String(collectionPayload.tx_ref)}`;
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
        tx_ref: String(collectionPayload.tx_ref),
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
        .contains("metadata", { tx_ref: String(collectionPayload.tx_ref), source: "flutterwave" })
        .maybeSingle();

      if (!existingNotification?.id) {
        await supa.from("notifications").insert({
          user_id: resolvedUserId,
          type: "transaction",
          title: "Deposit received",
          body: `Received ${Number.isFinite(amount) ? amount : 0} ${currency}.`,
          metadata: {
            source: "flutterwave",
            tx_ref: String(collectionPayload.tx_ref),
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
          entity_id: collectionId || String(collectionPayload.tx_ref),
          user_id: accountType === "business" ? null : resolvedUserId,
          business_user_id: accountType === "business" ? resolvedUserId : null,
          currency,
          amount_minor: amountMinor,
          direction: "credit",
          metadata: {
            source: "flutterwave",
            tx_ref: String(collectionPayload.tx_ref),
            flutterwave_collection_id: collectionId || null,
            flutterwave_event_id: eventId,
          },
        }, { onConflict: "event_id" });
      }
    }
  }

  await markWebhookEventStatus(eventId, "completed");
  return json({
    success: true,
    code: "flutterwave_webhook_accepted",
    data: {
      event_type: eventType,
      received_at: new Date().toISOString(),
      processing_mode: "projected",
      flow: "collection",
      tx_ref: txRef || null,
      reference: null,
      status,
    },
  }, 202);
});

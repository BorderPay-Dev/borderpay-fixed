import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  verifyFlutterwaveWebhookSignature,
  getFlutterwaveLocalRailPolicy,
} from "../_shared/providers/flutterwave.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, verif-hash, x-verif-hash, x-flutterwave-signature, x-borderpay-replay-key",
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

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTransferEvent(eventType: string): boolean {
  const e = eventType.toLowerCase();
  return e.includes("transfer") || e.includes("payout");
}

function keepTerminalStatus(existingStatus: unknown, incomingStatus: "pending" | "completed" | "failed") {
  const current = String(existingStatus || "").toLowerCase();
  if (current === "completed" || current === "failed") return current as "completed" | "failed";
  return incomingStatus;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function deriveEventId(params: {
  payloadEventId: unknown;
  eventType: string;
  collectionId: string;
  transferReference: string;
  txRef: string;
  rawBody: string;
}): Promise<string> {
  const payloadId = String(params.payloadEventId || "").trim();
  if (payloadId) return payloadId;

  const stableRef = params.collectionId || params.transferReference || params.txRef || "no-ref";
  const payloadHash = await sha256Hex(params.rawBody || "{}");
  return `flw:${params.eventType}:${stableRef}:${payloadHash.slice(0, 24)}`;
}

async function claimWebhookEvent(
  eventId: string,
  eventType: string,
  flow: "collection" | "transfer" | "unknown",
  payload: unknown,
  replayKey: string,
) {
  const allowReprocessFailed = (Deno.env.get("FLW_WEBHOOK_ALLOW_REPROCESS_FAILED") || "false").toLowerCase() === "true";
  const expectedReplayKey = String(Deno.env.get("FLW_WEBHOOK_REPLAY_KEY") || "").trim();

  const { data: existing, error: existingErr } = await supa
    .from("flutterwave_webhook_events")
    .select("id,processing_status,processing_attempts,last_error")
    .eq("event_id", eventId)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing?.id) {
    if (
      existing.processing_status === "failed"
      && allowReprocessFailed
      && expectedReplayKey.length > 0
      && replayKey === expectedReplayKey
    ) {
      const { error: reprocessErr } = await supa
        .from("flutterwave_webhook_events")
        .update({
          processing_status: "processing",
          processed_at: null,
          processing_attempts: Number(existing.processing_attempts || 0) + 1,
          last_error: {},
          metadata: { source: "flutterwave", replayed: true, replayed_at: new Date().toISOString() },
          payload: payload ?? {},
        })
        .eq("event_id", eventId);
      if (reprocessErr) throw reprocessErr;
      return {
        claimed: true as const,
        duplicate: false as const,
        replayed: true as const,
        blocked: false as const,
        processing_attempts: Number(existing.processing_attempts || 0) + 1,
      };
    }
    if (existing.processing_status === "failed" && allowReprocessFailed && expectedReplayKey.length > 0 && replayKey !== expectedReplayKey) {
      return {
        claimed: false as const,
        duplicate: false as const,
        replayed: false as const,
        blocked: true as const,
        block_reason: "replay_key_required" as const,
        processing_attempts: Number(existing.processing_attempts || 0),
        last_error: existing.last_error || {},
      };
    }
    return {
      claimed: false as const,
      duplicate: true as const,
      replayed: false as const,
      blocked: false as const,
      processing_attempts: Number(existing.processing_attempts || 0),
      last_error: existing.last_error || {},
    };
  }

  const { data, error } = await supa
    .from("flutterwave_webhook_events")
    .insert({
      event_id: eventId,
      event_type: eventType,
      flow,
      processing_status: "processing",
      processing_attempts: 1,
      payload: payload ?? {},
      metadata: { source: "flutterwave" },
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if ((error as any)?.code === "23505") return { claimed: false as const, duplicate: true as const, replayed: false as const, blocked: false as const };
    throw error;
  }

  return {
    claimed: Boolean(data?.id),
    duplicate: false as const,
    replayed: false as const,
    blocked: false as const,
    processing_attempts: 1,
  };
}

async function markWebhookEventStatus(eventId: string, status: "completed" | "failed", lastError: Record<string, unknown> = {}) {
  await supa
    .from("flutterwave_webhook_events")
    .update({
      processing_status: status,
      processed_at: new Date().toISOString(),
      last_error: status === "failed" ? lastError : {},
    })
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
  const currency = String(data?.currency || "").trim().toUpperCase();
  const amount = Number(data?.amount || data?.charged_amount || 0);
  const eventId = await deriveEventId({
    payloadEventId: payload?.id,
    eventType,
    collectionId,
    transferReference,
    txRef,
    rawBody,
  });
  const rawAccountType = String(data?.meta?.borderpay_account_type || "").toLowerCase();
  const accountType: "individual" | "business" | null = rawAccountType === "business"
    ? "business"
    : rawAccountType === "individual"
    ? "individual"
    : null;
  const userIdFromMetaRaw = String(data?.meta?.borderpay_user_id || "").trim();
  const userIdFromMeta = isLikelyUuid(userIdFromMetaRaw) ? userIdFromMetaRaw : "";
  const flow: "collection" | "transfer" | "unknown" = transferEvent ? "transfer" : "collection";
  const replayKey = String(req.headers.get("x-borderpay-replay-key") || "").trim();

  const claim = await claimWebhookEvent(eventId, eventType, flow, payload, replayKey);
  if (!claim.claimed) {
    if (claim.blocked) {
      await markWebhookEventStatus(eventId, "failed", {
        code: "replay_blocked",
        reason: claim.block_reason || "policy_blocked",
        at: new Date().toISOString(),
      });
      return json({
        success: false,
        code: "flutterwave_webhook_replay_blocked",
        error: "Replay denied. Valid replay key is required for failed-event reprocessing.",
        data: {
          event_type: eventType,
          event_id: eventId,
          flow,
          processing_mode: "replay_blocked",
          reason: claim.block_reason || "policy_blocked",
          processing_attempts: claim.processing_attempts ?? null,
          last_error: claim.last_error ?? {},
        },
      }, 403);
    }
    return json({
      success: true,
      code: "flutterwave_webhook_duplicate_ignored",
      data: {
        event_type: eventType,
        event_id: eventId,
        flow,
        processing_mode: claim.replayed ? "replayed" : "duplicate_ignored",
        processing_attempts: claim.processing_attempts ?? null,
        last_error: claim.last_error ?? {},
      },
    }, 200);
  }

  try {
  if (transferEvent && !transferReference && !transferId) {
    await markWebhookEventStatus(eventId, "failed", {
      code: "webhook_transfer_reference_missing",
      reason: "transfer_reference_missing_in_payload",
      at: new Date().toISOString(),
    });
    return json({
      success: false,
      code: "webhook_transfer_reference_missing",
      error: "Webhook payload missing transfer reference/id",
      data: { event_id: eventId, event_type: eventType, flow },
    }, 422);
  }
  if (!transferEvent && !txRef && !collectionId) {
    await markWebhookEventStatus(eventId, "failed", {
      code: "webhook_collection_reference_missing",
      reason: "collection_reference_missing_in_payload",
      at: new Date().toISOString(),
    });
    return json({
      success: false,
      code: "webhook_collection_reference_missing",
      error: "Webhook payload missing collection reference/id",
      data: { event_id: eventId, event_type: eventType, flow },
    }, 422);
  }
  if (!currency) {
    await markWebhookEventStatus(eventId, "failed", {
      code: "webhook_currency_missing",
      reason: "currency_missing_in_payload",
      at: new Date().toISOString(),
    });
    return json({
      success: false,
      code: "webhook_currency_missing",
      error: "Webhook payload missing currency",
      data: { event_id: eventId, event_type: eventType, flow },
    }, 422);
  }
  const localRailPolicy = getFlutterwaveLocalRailPolicy();
  const supportedCurrencies = localRailPolicy.currencies as readonly string[];
  if (!supportedCurrencies.includes(currency)) {
    await markWebhookEventStatus(eventId, "failed", {
      code: "webhook_currency_not_supported",
      reason: "currency_not_enabled_on_local_rails",
      at: new Date().toISOString(),
      currency,
    });
    return json({
      success: false,
      code: "webhook_currency_not_supported",
      error: "Webhook currency is not enabled on local rails",
      data: { event_id: eventId, event_type: eventType, flow, currency, supported_currencies: supportedCurrencies },
    }, 409);
  }

  if (transferEvent) {
    const transferProjectionKey = transferReference || transferId || eventId;
    const { data: existingTransfer } = await supa
      .from("flutterwave_transfers")
      .select("status")
      .eq("reference", transferProjectionKey)
      .maybeSingle();
    const effectiveStatus = keepTerminalStatus(existingTransfer?.status, status);

    const transferPayload: Record<string, unknown> = {
      reference: transferProjectionKey,
      flutterwave_transfer_id: transferId || null,
      flutterwave_event_id: eventId,
      amount: Number.isFinite(amount) ? amount : null,
      currency,
      status: effectiveStatus,
      metadata: {
        event_type: eventType,
          account_type: accountType,
        source: "flutterwave",
      },
      last_provider_status_at: new Date().toISOString(),
      last_webhook_event_at: new Date().toISOString(),
      raw_payload: payload,
    };

    if (userIdFromMeta && accountType === "business") {
      transferPayload.business_user_id = userIdFromMeta;
      transferPayload.user_id = null;
    } else if (userIdFromMeta && accountType === "individual") {
      transferPayload.user_id = userIdFromMeta;
      transferPayload.business_user_id = null;
    }

    const { error: transferErr } = await supa
      .from("flutterwave_transfers")
      .upsert(transferPayload, { onConflict: "reference" });

    if (transferErr) {
      await markWebhookEventStatus(eventId, "failed", {
        code: "transfer_projection_failed",
        reason: transferErr.message || "upsert_failed",
        at: new Date().toISOString(),
      });
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
      const txStatus = effectiveStatus === "completed" ? "completed" : effectiveStatus === "failed" ? "failed" : "pending";

      await supa.from("transactions").upsert({
        user_id: resolvedUserId,
        type: "transfer",
        amount: Number.isFinite(amount) ? amount : 0,
        currency,
        status: txStatus,
        reference,
        provider: "flutterwave",
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

      if (effectiveStatus === "completed" || effectiveStatus === "failed") {
        const { data: existingNotification } = await supa
          .from("notifications")
          .select("id")
          .eq("user_id", resolvedUserId)
          .eq("type", "transaction")
          .contains("metadata", { reference: String(transferPayload.reference), source: "flutterwave" })
          .maybeSingle();

        if (!existingNotification?.id) {
          const title = effectiveStatus === "completed" ? "Transfer completed" : "Transfer failed";
          const body = effectiveStatus === "completed"
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
              status: effectiveStatus,
            },
          });
        }
      }

      if (effectiveStatus === "completed") {
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
        status: effectiveStatus,
      },
    }, 202);
  }

  const collectionProjectionKey = txRef || collectionId || eventId;
  const { data: existingCollection } = await supa
    .from("flutterwave_collections")
    .select("status")
    .eq("tx_ref", collectionProjectionKey)
    .maybeSingle();
  const effectiveStatus = keepTerminalStatus(existingCollection?.status, status);

  const collectionPayload: Record<string, unknown> = {
    tx_ref: collectionProjectionKey,
    flutterwave_collection_id: collectionId || null,
    flutterwave_event_id: eventId,
    amount: Number.isFinite(amount) ? amount : null,
    currency,
    status: effectiveStatus,
    metadata: {
      event_type: eventType,
      account_type: accountType,
      source: "flutterwave",
    },
    last_provider_status_at: new Date().toISOString(),
    last_webhook_event_at: new Date().toISOString(),
    raw_payload: payload,
  };

  if (userIdFromMeta && accountType === "business") {
    collectionPayload.business_user_id = userIdFromMeta;
    collectionPayload.user_id = null;
  } else if (userIdFromMeta && accountType === "individual") {
    collectionPayload.user_id = userIdFromMeta;
    collectionPayload.business_user_id = null;
  }

  const { error: colErr } = await supa
    .from("flutterwave_collections")
    .upsert(collectionPayload, { onConflict: "tx_ref" });

  if (colErr) {
    await markWebhookEventStatus(eventId, "failed", {
      code: "collection_projection_failed",
      reason: colErr.message || "upsert_failed",
      at: new Date().toISOString(),
    });
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
    const txStatus = effectiveStatus === "completed" ? "completed" : effectiveStatus === "failed" ? "failed" : "pending";

    await supa.from("transactions").upsert({
      user_id: resolvedUserId,
      type: "deposit",
      amount: Number.isFinite(amount) ? amount : 0,
      currency,
      status: txStatus,
      reference,
      provider: "flutterwave",
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

    if (effectiveStatus === "completed") {
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
      status: effectiveStatus,
    },
  }, 202);
  } catch (e) {
    await markWebhookEventStatus(eventId, "failed", {
      code: "webhook_processing_failed",
      reason: String((e as any)?.message || "unexpected_error"),
      at: new Date().toISOString(),
    });
    return json({
      success: false,
      code: "flutterwave_webhook_processing_failed",
      error: "Failed to process webhook event.",
      data: {
        event_type: eventType,
        event_id: eventId,
        flow,
      },
    }, 500);
  }
});

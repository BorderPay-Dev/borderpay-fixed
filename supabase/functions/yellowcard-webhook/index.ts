import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getYellowCardConfig, getYellowCardWebhookCredentials } from "../_shared/providers/yellowcard-client.ts";
import {
  normalizeYellowCardWebhook,
  parseYellowCardWebhook,
  verifyYellowCardWebhookSignature,
} from "../_shared/providers/yellowcard-webhook.ts";
import { yellowCardJitWebhookTarget } from "../_shared/providers/yellowcard-jit-webhook.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ success: false, code: "method_not_allowed" }, 405);
  const declaredLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > 262_144) {
    return json({ success: false, code: "payload_too_large" }, 413);
  }
  const rawBody = await req.text();
  if (!rawBody || rawBody.length > 262_144) return json({ success: false, code: "invalid_body_size" }, 400);

  const config = getYellowCardConfig();
  const credentials = getYellowCardWebhookCredentials();
  if (!config.configured || config.environment !== "production" || !credentials.apiKey || !credentials.secretKey) {
    return json({ success: false, code: "yellow_card_webhook_not_configured" }, 503);
  }
  const signature = req.headers.get("X-YC-Signature") || "";
  if (!await verifyYellowCardWebhookSignature(rawBody, signature, credentials.secretKey)) {
    return json({ success: false, code: "invalid_signature" }, 401);
  }

  try {
    const payload = parseYellowCardWebhook(rawBody);
    const event = normalizeYellowCardWebhook(payload);
    if (event.apiKey !== credentials.apiKey) return json({ success: false, code: "api_key_mismatch" }, 401);

    const fingerprint = await sha256Hex(`production:${event.event}:${event.sequenceId}:${event.executedAt}:${rawBody}`);
    const { data: jitPayout, error: jitLookupError } = await supabase
      .from("yellowcard_jit_payouts")
      .select("id,state,sequence_id,yellowcard_send_transaction_id")
      .eq("sequence_id", event.sequenceId)
      .maybeSingle();
    if (jitLookupError) throw new Error(`yellow_card_jit_lookup_failed:${jitLookupError.message}`);
    if (jitPayout?.id) {
      const target = yellowCardJitWebhookTarget({
        event: event.event,
        status: event.status,
        currentState: jitPayout.state,
      });
      if (target) {
        const { error: transitionError } = await supabase.rpc("transition_yellowcard_jit_payout", {
          p_payout_id: jitPayout.id,
          p_event_key: `yellowcard:${fingerprint}`,
          p_to_state: target,
          p_source: "yellowcard_webhook",
          p_evidence: {
            event: event.event,
            status: event.status,
            sequence_id: event.sequenceId,
            provider_transaction_id: event.providerTransactionId,
            executed_at: event.executedAt,
            error_code: event.errorCode,
          },
          p_provider_status: event.status,
          p_yellowcard_credit_transaction_id: event.event.startsWith("CRYPTO_RECEIVE.")
            ? event.providerTransactionId
            : null,
          p_yellowcard_send_transaction_id: event.event.startsWith("SEND.")
            ? event.providerTransactionId
            : null,
          p_failure_code: target === "FAILED" ? event.errorCode || event.status : null,
          p_failure_detail: target === "FAILED" ? `Yellow Card ${event.event}` : null,
        });
        if (transitionError) throw new Error(`yellow_card_jit_transition_failed:${transitionError.message}`);
      }
      return json({ success: true, code: target ? "jit_payout_projected" : "jit_event_recorded" });
    }
    const { data: result, error } = await supabase.rpc("apply_yellowcard_webhook_event", {
      p_environment: "production",
      p_event_fingerprint: fingerprint,
      p_sequence_id: event.sequenceId,
      p_provider_transaction_id: event.providerTransactionId,
      p_event_name: event.event,
      p_status: event.status,
      p_api_key_prefix: `${event.apiKey.slice(0, 6)}...`,
      p_raw_payload: payload,
      p_executed_at: event.executedAt,
      p_direction: event.direction,
      p_project_transaction: event.projectTransaction,
      p_error_code: event.errorCode,
    });
    if (error) throw new Error(`yellow_card_webhook_apply_failed:${error.message}`);
    const code = String(result?.code || "yellow_card_webhook_apply_failed");
    if (code === "transaction_not_found_retry") return json({ success: false, code }, 503);
    if (["direction_mismatch", "provider_transaction_mismatch"].includes(code)) {
      return json({ success: false, code }, 409);
    }
    return json({ success: true, code });
  } catch (error) {
    const message = error instanceof Error ? error.message : "yellow_card_webhook_failed";
    const contractError = message.startsWith("yellow_card_webhook_invalid");
    console.error("yellowcard-webhook", { code: message });
    return json({ success: false, code: contractError ? message : "yellow_card_webhook_failed" }, contractError ? 400 : 500);
  }
});

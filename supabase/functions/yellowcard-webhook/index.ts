import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getYellowCardConfig, getYellowCardWebhookCredentials } from "../_shared/providers/yellowcard-client.ts";
import {
  normalizeYellowCardWebhook,
  parseYellowCardWebhook,
  verifyYellowCardWebhookSignature,
} from "../_shared/providers/yellowcard-webhook.ts";

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

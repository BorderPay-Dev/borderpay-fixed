import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  ApiWebhookSecurityError,
  decryptApiWebhookSecret,
  signApiWebhookPayload,
  validateApiWebhookEndpointUrl,
} from "../_shared/api-webhook-security.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WORKER_TOKEN = Deno.env.get("API_WEBHOOK_WORKER_TOKEN") ?? "";
const WORKER_ID = `api-webhook-worker:${crypto.randomUUID()}`;
const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type ClaimedDelivery = {
  delivery_id: string;
  attempt_count: number;
  event_id: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  event_occurred_at: string;
  endpoint_id: string;
  endpoint_url: string;
  signing_secret_ciphertext: string;
  signing_secret_nonce: string;
  signing_secret_version: number;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function timingSafeEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function finish(
  deliveryId: string,
  success: boolean,
  responseStatus: number | null,
  error: string | null,
  terminal = false,
): Promise<void> {
  const { data, error: rpcError } = await db.rpc("api_webhook_finish_delivery", {
    p_delivery_id: deliveryId,
    p_worker_id: WORKER_ID,
    p_success: success,
    p_response_status: responseStatus,
    p_error: error,
    p_terminal: terminal,
  });
  if (rpcError || data !== true) {
    throw new Error(`Could not finish webhook delivery: ${rpcError?.message ?? "lease lost"}`);
  }
}

async function deliver(item: ClaimedDelivery): Promise<"delivered" | "retrying" | "dead"> {
  try {
    const endpointUrl = validateApiWebhookEndpointUrl(item.endpoint_url);
    const secret = await decryptApiWebhookSecret(
      item.signing_secret_ciphertext,
      item.signing_secret_nonce,
      item.endpoint_id,
      Number(item.signing_secret_version),
    );
    const body = JSON.stringify({
      id: item.event_id,
      type: item.event_type,
      occurred_at: item.event_occurred_at,
      data: item.event_payload,
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await signApiWebhookPayload(secret, timestamp, body);
    const response = await fetch(endpointUrl, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "BorderPay-Partner-Webhooks/1.0",
        "X-BorderPay-Delivery-Id": item.delivery_id,
        "X-BorderPay-Event-Id": item.event_id,
        "X-BorderPay-Timestamp": timestamp,
        "X-BorderPay-Signature": signature,
      },
      body,
    });
    if (response.status >= 200 && response.status < 300) {
      await finish(item.delivery_id, true, response.status, null);
      return "delivered";
    }
    const terminal = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
    await finish(item.delivery_id, false, response.status, `HTTP ${response.status}`, terminal);
    return terminal ? "dead" : "retrying";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const terminal = error instanceof ApiWebhookSecurityError;
    await finish(item.delivery_id, false, null, message.slice(0, 1000), terminal);
    return terminal ? "dead" : "retrying";
  }
}

async function drain(batchSize: number): Promise<Record<string, number>> {
  const { data, error } = await db.rpc("api_webhook_claim_deliveries", {
    p_worker_id: WORKER_ID,
    p_batch_size: Math.min(Math.max(batchSize, 1), 100),
    p_lease_seconds: 120,
  });
  if (error) throw new Error(`Could not claim webhook deliveries: ${error.message}`);
  const claimed = (data ?? []) as ClaimedDelivery[];
  const result = { claimed: claimed.length, delivered: 0, retrying: 0, dead: 0 };
  for (const item of claimed) result[await deliver(item)]++;
  return result;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  if (!WORKER_TOKEN) return json({ success: false, error: "Worker is not configured" }, 503);
  const supplied = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!timingSafeEqual(supplied, WORKER_TOKEN)) return json({ success: false, error: "Unauthorized" }, 401);
  try {
    const body = await request.json().catch(() => ({}));
    return json({ success: true, data: await drain(Number(body?.batch_size ?? 50)) });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

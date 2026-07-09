import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function cleanString(value: unknown, max = 240): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function redactPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const clone = JSON.parse(JSON.stringify(value));
  const redactKeys = new Set(["authorization", "api-key", "apikey", "transaction_pin", "pin"]);
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      if (redactKeys.has(key.toLowerCase())) {
        (node as Record<string, unknown>)[key] = "[redacted]";
      } else {
        walk(val);
      }
    }
  };
  walk(clone);
  return clone;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Unauthorized" }, 401);

  const { data: authData, error: authError } = await supa.auth.getUser(token);
  if (authError || !authData.user) return json({ success: false, error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    body = { stage: "invalid_json" };
  }

  const currency = cleanString(body.currency ?? body.asset, 24)?.toUpperCase() ?? null;
  const network = cleanString(body.network, 48)?.toLowerCase() ?? null;
  const method = cleanString(body.method, 64);
  const idempotencyKey = cleanString(body.idempotency_key, 160);
  const stage = `client_${cleanString(body.stage, 96) ?? "send_trace"}`;

  const { error } = await supa.from("bridge_transfer_traces").insert({
    correlation_id: idempotencyKey,
    user_id: authData.user.id,
    idempotency_key: idempotencyKey,
    endpoint: "client-send-flow",
    method: "CLIENT",
    source_payment_rail: cleanString(body.source_payment_rail, 64) ?? "bridge_wallet",
    destination_payment_rail: cleanString(body.destination_payment_rail ?? network ?? method, 64),
    asset: currency,
    network,
    amount: cleanString(body.amount, 64),
    source_wallet_id: cleanString(body.source_wallet_id, 160),
    destination_bridge_wallet_id: cleanString(body.destination_bridge_wallet_id, 160),
    destination_external_account_id: cleanString(body.destination_external_account_id, 160),
    destination_address: cleanString(body.destination_address, 240),
    http_status: typeof body.http_status === "number" ? body.http_status : null,
    bridge_error_code: cleanString(body.code, 160),
    bridge_error_message: cleanString(body.error, 500),
    request_payload: redactPayload(body),
    response_payload: redactPayload(body.response ?? null),
    transfer_id: cleanString(body.transfer_id, 160),
    stage,
    notes: cleanString(body.notes, 500),
    provider_status: cleanString(body.provider_status, 160),
  });

  if (error) return json({ success: false, error: "Trace write failed" }, 500);
  return json({ success: true, data: { stage } });
});

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

  // Stage-1 scaffold only: acknowledge valid signed events.
  // No ledger/projection mutation in this function yet.
  return json({
    success: true,
    code: "flutterwave_webhook_accepted",
    data: {
      event_type: String(payload?.event || payload?.event_type || "unknown"),
      received_at: new Date().toISOString(),
      processing_mode: "scaffold_ack_only",
    },
  }, 202);
});


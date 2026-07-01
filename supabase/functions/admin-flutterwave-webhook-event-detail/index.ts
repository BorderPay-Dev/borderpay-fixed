import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function requireAdmin(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false as const, status: 401, code: "missing_bearer_token", error: "Authentication required" };
  const { data: authData, error: authErr } = await supa.auth.getUser(token);
  const user = authData?.user;
  if (authErr || !user) return { ok: false as const, status: 401, code: "invalid_auth_token", error: "Unauthorized" };
  const { data: profile } = await supa
    .from("user_profiles")
    .select("id,is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return { ok: false as const, status: 403, code: "admin_only", error: "Admin access required" };
  return { ok: true as const };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const admin = await requireAdmin(req);
  if (!admin.ok) return json({ success: false, code: admin.code, error: admin.error }, admin.status);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, code: "invalid_json_payload", error: "Invalid JSON payload" }, 400);
  }

  const eventId = String(body?.event_id || "").trim();
  if (!eventId) return json({ success: false, code: "event_id_required", error: "event_id is required" }, 400);

  const { data: eventRow, error: eventErr } = await supa
    .from("flutterwave_webhook_events")
    .select("event_id,event_type,flow,processing_status,processing_attempts,last_error,payload,received_at,processed_at")
    .eq("event_id", eventId)
    .maybeSingle();
  if (eventErr) return json({ success: false, code: "event_lookup_failed", error: eventErr.message }, 500);
  if (!eventRow) return json({ success: false, code: "event_not_found", error: "Webhook event not found" }, 404);

  const payload = (eventRow.payload || {}) as Record<string, unknown>;
  const data = (payload.data && typeof payload.data === "object") ? payload.data as Record<string, unknown> : payload;
  const txRef = String(data?.tx_ref || data?.reference || data?.txRef || "").trim();
  const transferRef = String(data?.reference || data?.tx_ref || "").trim();
  const flow = String(eventRow.flow || "unknown").toLowerCase();

  let projection: Record<string, unknown> | null = null;
  if (flow === "collection") {
    const { data: p } = await supa
      .from("flutterwave_collections")
      .select("tx_ref,flutterwave_collection_id,status,user_id,business_user_id,last_provider_status_at,last_webhook_event_at,updated_at")
      .eq("tx_ref", txRef)
      .maybeSingle();
    projection = p || null;
  } else if (flow === "transfer") {
    const { data: p } = await supa
      .from("flutterwave_transfers")
      .select("reference,flutterwave_transfer_id,status,user_id,business_user_id,last_provider_status_at,last_webhook_event_at,updated_at")
      .eq("reference", transferRef)
      .maybeSingle();
    projection = p || null;
  }

  return json({
    success: true,
    data: {
      event: eventRow,
      extracted_refs: {
        tx_ref: txRef || null,
        transfer_reference: transferRef || null,
        payload_id: String(payload?.id || "") || null,
      },
      projection,
      triage: {
        has_projection: !!projection,
        replay_recommended: String(eventRow.processing_status || "") === "failed",
      },
    },
  });
});

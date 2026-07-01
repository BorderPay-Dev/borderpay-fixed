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

  const status = String(body?.status || "failed").trim().toLowerCase();
  const flow = String(body?.flow || "").trim().toLowerCase();
  const includePayload = body?.include_payload === true;
  const limit = Math.max(1, Math.min(200, Number(body?.limit || 50)));
  const from = Number(body?.from || 0);

  const selectCols = includePayload
    ? "event_id,event_type,flow,processing_status,processing_attempts,last_error,payload,received_at,processed_at"
    : "event_id,event_type,flow,processing_status,processing_attempts,last_error,received_at,processed_at";

  let query = supa
    .from("flutterwave_webhook_events")
    .select(selectCols, { count: "exact" })
    .order("received_at", { ascending: false })
    .range(from, from + limit - 1);

  if (status) query = query.eq("processing_status", status);
  if (flow) query = query.eq("flow", flow);

  const { data, error, count } = await query;
  if (error) {
    return json({ success: false, code: "query_failed", error: error.message }, 500);
  }

  const events = (data || []).map((row: Record<string, unknown>) => {
    if (includePayload) return row;
    const payload = (row.payload as Record<string, unknown>) || {};
    return {
      ...row,
      payload_preview: {
        event: payload?.event || payload?.event_type || null,
        data_id: (payload?.data as Record<string, unknown> | undefined)?.id || null,
        tx_ref:
          (payload?.data as Record<string, unknown> | undefined)?.tx_ref
          || (payload?.data as Record<string, unknown> | undefined)?.reference
          || null,
      },
    };
  });

  return json({
    success: true,
    data: {
      events,
      total: count || 0,
      page: { from, limit },
      filters: { status, flow: flow || null, include_payload: includePayload },
    },
  });
});

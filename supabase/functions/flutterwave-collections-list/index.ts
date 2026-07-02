import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { flutterwaveListCollections, getFlutterwaveCapabilities } from "../_shared/providers/flutterwave.ts";
import { mapFlutterwaveErrorResponse } from "../_shared/providers/flutterwave-error-response.ts";

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

function withProjectionAlerts(rows: Record<string, unknown>[]) {
  const now = Date.now();
  const staleMinutes = Number(Deno.env.get("FLW_PROJECTION_STALE_MINUTES") || 30);
  return rows.map((row) => {
    const providerAt = row.last_provider_status_at ? Date.parse(String(row.last_provider_status_at)) : NaN;
    const webhookAt = row.last_webhook_event_at ? Date.parse(String(row.last_webhook_event_at)) : NaN;
    const status = String(row.status || "").toLowerCase();
    const providerAgeMinutes = Number.isFinite(providerAt) ? Math.floor((now - providerAt) / 60000) : null;
    const webhookLagMinutes =
      Number.isFinite(providerAt) && Number.isFinite(webhookAt)
        ? Math.floor(Math.max(0, providerAt - webhookAt) / 60000)
        : null;
    return {
      ...row,
      projection_alerts: {
        stale_provider_status: providerAgeMinutes !== null ? providerAgeMinutes > staleMinutes : false,
        missing_webhook_after_terminal_poll:
          (status === "completed" || status === "failed")
            ? !Number.isFinite(webhookAt) || (webhookLagMinutes !== null && webhookLagMinutes > 5)
            : false,
      },
      provider_age_minutes: providerAgeMinutes,
      webhook_lag_minutes: webhookLagMinutes,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const caps = getFlutterwaveCapabilities();
  if (!caps.configured || !caps.receive_enabled) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "Flutterwave collection list endpoint is not enabled in this environment.",
      data: { capabilities: caps },
    }, 503);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: authData, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !authData?.user?.id) return json({ success: false, error: "Unauthorized" }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const page = Number.isFinite(Number(body?.page)) ? Math.max(1, Number(body.page)) : undefined;
  const limit = Number.isFinite(Number(body?.limit)) ? Math.max(1, Math.min(100, Number(body.limit))) : 50;

  const res = await flutterwaveListCollections({
    ...(body?.tx_ref ? { tx_ref: String(body.tx_ref) } : {}),
    ...(body?.status ? { status: String(body.status) } : {}),
    ...(body?.from ? { from: String(body.from) } : {}),
    ...(body?.to ? { to: String(body.to) } : {}),
    ...(Number.isFinite(Number(page)) ? { page } : {}),
    ...(Number.isFinite(Number(limit)) ? { limit } : {}),
  });

  if (!res.ok) {
    const mapped = mapFlutterwaveErrorResponse(res.error, res.error || "Failed to list collections");
    return json({
      success: false,
      code: mapped.code,
      error: mapped.error,
      data: { capabilities: caps },
    }, mapped.status);
  }

  const accountType = String(body?.account_type || "individual").toLowerCase();
  if (!["individual", "business"].includes(accountType)) {
    return json({ success: false, code: "invalid_account_type", error: "account_type must be individual or business." }, 400);
  }
  if (accountType === "business") {
    const { data: businessProfile } = await supa
      .from("business_profiles")
      .select("id,user_id")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (!businessProfile?.id) {
      return json({ success: false, code: "business_profile_required", error: "Business profile is required for business collection views." }, 403);
    }
  }
  const ownerColumn = accountType === "business" ? "business_user_id" : "user_id";
  const { data: projectedCollections } = await supa
    .from("flutterwave_collections")
    .select("tx_ref,flutterwave_collection_id,amount,currency,status,metadata,last_provider_status_at,last_webhook_event_at,created_at,updated_at")
    .eq(ownerColumn, authData.user.id)
    .order("updated_at", { ascending: false })
    .limit(limit);

  return json({
    success: true,
    data: {
      capabilities: caps,
      provider_request_id: res.requestId || null,
      collections: res.data,
      projected_collections: withProjectionAlerts((projectedCollections || []) as Record<string, unknown>[]),
    },
  });
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getYellowCardConfig, yellowCardFetch } from "../_shared/providers/yellowcard-client.ts";

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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function authorize(req: Request): Promise<{ ok: true; actorId: string } | { ok: false; status: number; body: unknown }> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, body: { success: false, error: "Authorization required" } };
  if (SUPABASE_SERVICE_ROLE && token === SUPABASE_SERVICE_ROLE) return { ok: true, actorId: "service_role" };
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user?.id) return { ok: false, status: 401, body: { success: false, error: "Unauthorized" } };
  const { data: adminRow } = await supa
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!adminRow?.user_id) {
    return { ok: false, status: 403, body: { success: false, code: "admin_only", error: "Admin access required." } };
  }
  return { ok: true, actorId: user.id };
}

function channelToRail(value: unknown): "bank" | "mobile_money" | null {
  const v = String(value || "").trim().toLowerCase();
  if (v === "momo" || v === "mobile_money" || v === "mobilemoney") return "mobile_money";
  if (v === "bank" || v === "eft" || v === "p2p") return "bank";
  return null;
}

function rampToDirection(value: unknown): "payout" | "receive" | null {
  const v = String(value || "").trim().toLowerCase();
  if (["withdraw", "send", "payout", "offramp", "off-ramp"].includes(v)) return "payout";
  if (["deposit", "receive", "collection", "payin", "pay-in", "onramp", "on-ramp"].includes(v)) return "receive";
  return null;
}

function active(value: unknown): boolean {
  const v = String(value || "").trim().toLowerCase();
  return v === "active" || v === "enabled" || v === "available";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const auth = await authorize(req);
  if (!auth.ok) return json(auth.body, auth.status);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const config = getYellowCardConfig();
  if (!config.configured) {
    return json({ success: false, code: "yellow_card_not_configured", error: "Yellow Card credentials are not configured.", data: { config } }, 503);
  }

  const country = String(body?.country || "").trim().toUpperCase();
  const dryRun = body?.dry_run !== false;
  const enabled = false;
  if (!dryRun || body?.enable_rows === true) {
    return json({
      success: false,
      code: "yellow_card_commercial_map_required",
      error: "Yellow Card provider discovery is read-only. Corridor activation must follow the approved internal commercial map.",
    }, 403);
  }
  const res = await yellowCardFetch({
    method: "GET",
    path: "/channels",
    query: country ? { country } : undefined,
  });
  if (!res.ok) {
    return json({ success: false, code: "yellow_card_channels_failed", error: res.error || "Failed to load Yellow Card channels.", data: { status: res.status, request_id: res.requestId } }, 502);
  }

  const channels = Array.isArray(res.data) ? res.data : [];
  const rows = channels
    .map((channel: any) => {
      const rail = channelToRail(channel?.channelType);
      const direction = rampToDirection(channel?.rampType);
      const countryCode = String(channel?.country || "").trim().toUpperCase();
      const currency = String(channel?.currency || channel?.countryCurrency || "").trim().toUpperCase();
      const isActive = active(channel?.apiStatus || channel?.status);
      if (!rail || !direction || !countryCode || !currency || !isActive) return null;
      return {
        provider: "yellow_card",
        direction,
        country_code: countryCode,
        destination_currency: currency,
        channel: rail,
        enabled,
        requires_bridge_kyc: true,
        priority: Number.isFinite(Number(channel?.feeUSD)) ? 400 : 250,
        notes: `yc_channel_sync:${config.environment}`,
        provider_fee_usd: Number.isFinite(Number(channel?.feeUSD)) ? Number(channel.feeUSD) : null,
        provider_fee_local: Number.isFinite(Number(channel?.feeLocal)) ? Number(channel.feeLocal) : null,
        estimated_settlement_seconds: Number.isFinite(Number(channel?.estimatedSettlementTime)) ? Number(channel.estimatedSettlementTime) : null,
        provider_channel_id: String(channel?.id || channel?.vendorId || "").trim() || null,
        provider_network_id: String(channel?.networkId || "").trim() || null,
        provider_channel_type: String(channel?.channelType || "").trim().toLowerCase() || null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  return json({
    success: true,
    data: {
      actor_id: auth.actorId,
      dry_run: dryRun,
      enable_rows: enabled,
      config,
      channel_count: channels.length,
      mapped_row_count: rows.length,
      rows,
    },
  });
});

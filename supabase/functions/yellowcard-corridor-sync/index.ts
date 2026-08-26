import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getYellowCardConfig, yellowCardFetch } from "../_shared/providers/yellowcard-client.ts";
import { yellowCardRows } from "../_shared/providers/yellowcard-routing.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function authorize(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (token === SERVICE_ROLE) return true;
  const { data, error } = await supa.auth.getUser(token);
  if (error || !data.user?.id) return false;
  const { data: admin } = await supa.from("admin_users").select("user_id").eq("user_id", data.user.id).maybeSingle();
  return Boolean(admin?.user_id);
}

async function catalog(path: "/channels" | "/networks", key: "channels" | "networks", country: string) {
  const filtered = await yellowCardFetch({ method: "GET", path, query: country ? { country } : undefined });
  if (filtered.ok && (!country || yellowCardRows(filtered.data, key).length > 0)) return filtered;
  if (!country || (!filtered.ok && filtered.status !== 400)) return filtered;
  return yellowCardFetch({ method: "GET", path });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  if (!await authorize(req)) return json({ success: false, code: "admin_only", error: "Admin access required." }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ success: false, code: "invalid_json" }, 400); }
  if (body?.dry_run === false || body?.enable_rows === true) {
    return json({
      success: false,
      code: "yellow_card_discovery_read_only",
      error: "Provider discovery cannot activate or mutate corridors.",
    }, 403);
  }

  const config = getYellowCardConfig();
  if (!config.configured || config.environment !== "production") {
    return json({ success: false, code: "yellow_card_production_unavailable" }, 503);
  }
  const country = String(body?.country || "").trim().toUpperCase();
  const [channels, networks] = await Promise.all([
    catalog("/channels", "channels", country),
    catalog("/networks", "networks", country),
  ]);
  if (!channels.ok || !networks.ok) {
    return json({
      success: false,
      code: channels.error || networks.error || "yellow_card_discovery_failed",
      data: {
        environment: "production",
        channels_status: channels.status,
        networks_status: networks.status,
        channels_request_id: channels.requestId || null,
        networks_request_id: networks.requestId || null,
      },
    }, 502);
  }
  return json({
    success: true,
    data: {
      environment: "production",
      dry_run: true,
      country: country || null,
      channel_count: yellowCardRows(channels.data, "channels").length,
      network_count: yellowCardRows(networks.data, "networks").length,
    },
  });
});

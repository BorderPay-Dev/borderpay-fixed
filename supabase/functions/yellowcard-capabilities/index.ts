import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateAfricanRailsTester } from "../_shared/african-rails-access.ts";
import { listProviderCorridors } from "../_shared/providers/provider-corridor-policy.ts";
import { getYellowCardConfig, yellowCardFetch } from "../_shared/providers/yellowcard-client.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  const access = await authenticateAfricanRailsTester(supa, req);
  if (!access.allowed) return json({ success: false, code: access.code, error: access.message }, access.status);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ success: false, code: "invalid_json" }, 400); }
  const config = getYellowCardConfig();
  if (!config.configured || config.environment !== "sandbox") {
    return json({ success: false, code: "yellow_card_sandbox_unavailable", error: "African rails testing is unavailable." }, 503);
  }

  const action = String(body?.action || "corridor_policy").trim().toLowerCase();
  const country = String(body?.country || "").trim().toUpperCase();
  const currency = String(body?.currency || "").trim().toUpperCase();
  if (action === "corridor_policy") {
    const direction = String(body?.direction || "receive").trim().toLowerCase();
    if (direction !== "receive") {
      return json({ success: true, data: { local_rail_policy: { provider: "yellow_card", direction, rows: [] } } });
    }
    const listed = await listProviderCorridors(supa, {
      provider: "yellow_card",
      direction: "receive",
      countryCode: country || null,
      enabledOnly: true,
    });
    if (!listed.ok) return json({ success: false, code: "policy_lookup_failed" }, 503);
    const publicRows = listed.rows.map((row) => ({
      provider: "yellow_card",
      direction: row.direction,
      country_code: row.country_code,
      source_currency: row.source_currency,
      destination_currency: row.destination_currency,
      channel: row.channel,
      enabled: row.enabled,
      requires_bridge_kyc: row.requires_bridge_kyc,
      priority: row.priority,
      customer_fee_percent: row.customer_fee_percent ?? null,
      customer_fee_usd: row.customer_fee_usd ?? null,
      customer_fee_local: row.customer_fee_local ?? null,
    }));
    return json({ success: true, data: { local_rail_policy: {
      provider: "yellow_card",
      direction: "receive",
      source: "approved_internal_commercial_map",
      rows: publicRows,
    } } });
  }
  const paths: Record<string, { path: string; query?: Record<string, string> }> = {
    channels: { path: "/channels", query: country ? { country } : undefined },
    networks: { path: "/networks", query: country ? { country } : undefined },
    rates: { path: "/rates", query: currency ? { currency } : undefined },
  };
  const selected = paths[action];
  if (!selected) return json({ success: false, code: "unsupported_action" }, 400);
  const res = await yellowCardFetch({ method: "GET", ...selected });
  return json({ success: res.ok, code: res.ok ? "ok" : res.error, data: { [action]: res.data } }, res.ok ? 200 : 502);
});

/**
 * get-momo-providers — Flutterwave-backed mobile network directory shim.
 *
 * Legacy endpoint kept for backend compatibility while we converge all
 * African rails to Flutterwave adapters.
 *
 * Input:
 *  - country: ISO2 country code (required)
 *
 * Output:
 *  - providers: normalized array of mobile network entries
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { flutterwaveListMobileNetworks, getFlutterwaveCapabilities } from "../_shared/providers/flutterwave.ts";
import { isProviderCorridorEnabled } from "../_shared/providers/provider-corridor-policy.ts";

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

function normalizeProviders(payload: any): Array<Record<string, unknown>> {
  const list =
    (Array.isArray(payload?.data) && payload.data)
    || (Array.isArray(payload?.mobile_networks) && payload.mobile_networks)
    || (Array.isArray(payload) && payload)
    || [];
  return list.map((row: any) => ({
    code: String(row?.code || row?.id || row?.network || "").trim(),
    name: String(row?.name || row?.network || row?.provider || "").trim(),
    country: String(row?.country || row?.country_code || "").toUpperCase().trim() || null,
    raw: row,
  })).filter((r) => r.code || r.name);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const caps = getFlutterwaveCapabilities();
  if (!caps.configured || !caps.receive_enabled) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "Mobile money provider directory is not enabled in this environment.",
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

  const country = String(body?.country || body?.country_code || "").trim().toUpperCase();
  if (!country) return json({ success: false, error: "country is required" }, 400);
  const destinationCurrency = String(body?.destination_currency || "").trim().toUpperCase();

  const corridor = await isProviderCorridorEnabled(supa, {
    provider: "flutterwave",
    direction: "payout",
    countryCode: country,
    channel: "mobile_money",
    destinationCurrency: destinationCurrency || undefined,
  });
  if (!corridor.enabled) {
    return json({
      success: false,
      code: corridor.code,
      error: corridor.code === "policy_lookup_failed"
        ? "Unable to validate corridor policy right now."
        : "Mobile money corridor is not enabled for this country.",
      data: { capabilities: caps, country },
    }, corridor.code === "policy_lookup_failed" ? 503 : 403);
  }

  const res = await flutterwaveListMobileNetworks(country);
  if (!res.ok) {
    return json({
      success: false,
      code: "upstream_error",
      error: res.error || "Failed to load mobile money providers",
      data: { capabilities: caps, country },
    }, 502);
  }

  return json({
    success: true,
    data: {
      country,
      providers: normalizeProviders(res.data),
      capabilities: caps,
    },
  });
});

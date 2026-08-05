import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { isAfricanRailsTesterEmail } from "../_shared/african-rails-access.ts";
import { listYellowCardCommercialRails, normalizeYellowCardCountryCode } from "../_shared/providers/yellowcard-commercial-policy.ts";
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
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, code: "authorization_required", error: "Authorization required" }, 401);
  const { data: authData, error: authError } = await supa.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user?.id) return json({ success: false, code: "unauthorized", error: "Unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ success: false, code: "invalid_json" }, 400); }
  const action = String(body?.action || "corridor_policy").trim().toLowerCase();
  const country = String(body?.country || "").trim().toUpperCase();
  const currency = String(body?.currency || "").trim().toUpperCase();
  if (action === "corridor_policy") {
    const direction = String(body?.direction || "receive").trim().toLowerCase();
    const testerAllReceiveCountries = direction === "receive" && isAfricanRailsTesterEmail(user.email);
    if (direction !== "receive" && direction !== "payout") {
      return json({ success: false, code: "unsupported_direction" }, 400);
    }
    let profileCountry = "";
    if (direction === "receive") {
      const { data: profile, error: profileError } = await supa
        .from("user_profiles")
        .select("country")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) return json({ success: false, code: "profile_country_lookup_failed" }, 503);
      profileCountry = normalizeYellowCardCountryCode(profile?.country);
      if (!testerAllReceiveCountries && !/^[A-Z]{2}$/.test(profileCountry)) {
        return json({ success: true, data: { local_rail_policy: {
          provider: "yellow_card", direction, source: "yellow_card_commercial_team_document_2026",
          eligibility: "account_country_only", account_country: null, rows: [],
        } } });
      }
    }
    const publicRows = listYellowCardCommercialRails(
      direction as "receive" | "payout",
      direction === "receive" && !testerAllReceiveCountries ? profileCountry : null,
    );
    return json({ success: true, data: { local_rail_policy: {
      provider: "yellow_card",
      direction,
      source: "yellow_card_commercial_team_document_2026",
      source_document_date: "2026-07-08",
      eligibility: testerAllReceiveCountries
        ? "integration_tester_all_receive_countries"
        : direction === "receive" ? "account_country_only" : "global_sender",
      account_country: direction === "receive" ? profileCountry : null,
      rows: publicRows,
    } } });
  }
  if (!isAfricanRailsTesterEmail(user.email)) {
    return json({ success: false, code: "african_rails_closed_beta", error: "Yellow Card integration testing is restricted." }, 403);
  }
  const config = getYellowCardConfig();
  if (!config.configured || config.environment !== "sandbox") {
    return json({ success: false, code: "yellow_card_sandbox_unavailable", error: "African rails testing is unavailable." }, 503);
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
